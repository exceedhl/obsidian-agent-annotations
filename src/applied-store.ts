import { APPLIED_FILE_NAME, APPLIED_RETRY_MS, BASELINES_FILE_NAME, STORE_DIR_NAME } from "./constants";
import { diffHunks, type TextHunk } from "./diff";
import { headingPathFromSource } from "./headings";
import { generateId } from "./ids";
import { anchoredReplacement, appliedRange, extractContext } from "./locate";
import { hasRange } from "./offsets";
import { parseAppliedFile, serializeAppliedFile } from "./applied-schema";
import type { StoreSnapshot } from "./store";
import { CONTEXT_RADIUS, type Annotation, type AppliedChange, type TextRange } from "./types";
import type { App } from "obsidian";

export interface AppliedIO {
	readApplied(): Promise<string | null>;
	writeApplied(content: string): Promise<void>;
	readNote(path: string): Promise<string | null>;
	readBaselines(): Promise<string | null>;
	writeBaselines(content: string): Promise<void>;
}

type Listener = () => void;

export function createVaultAppliedIO(app: App): AppliedIO {
	const dir = `${app.vault.configDir}/${STORE_DIR_NAME}`;
	const filePath = `${dir}/${APPLIED_FILE_NAME}`;
	const baselinePath = `${dir}/${BASELINES_FILE_NAME}`;
	return {
		async readApplied() {
			const adapter = app.vault.adapter;
			if (!(await adapter.exists(filePath))) return null;
			return adapter.read(filePath);
		},
		async writeApplied(content: string) {
			await writeVaultFile(app, dir, filePath, content);
		},
		async readNote(path: string) {
			const adapter = app.vault.adapter;
			if (!(await adapter.exists(path))) return null;
			return adapter.read(path);
		},
		async readBaselines() {
			const adapter = app.vault.adapter;
			if (!(await adapter.exists(baselinePath))) return null;
			return adapter.read(baselinePath);
		},
		async writeBaselines(content: string) {
			await writeVaultFile(app, dir, baselinePath, content);
		},
	};
}

async function writeVaultFile(app: App, dir: string, filePath: string, content: string): Promise<void> {
	const adapter = app.vault.adapter;
	if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
	const tmp = `${filePath}.tmp`;
	await adapter.write(tmp, content);
	await adapter.write(filePath, content);
	if (await adapter.exists(tmp)) await adapter.remove(tmp);
}

export class AppliedStore {
	changes: AppliedChange[] = [];
	private readonly listeners = new Set<Listener>();
	private readonly baselines = new Map<string, string>();
	private tracked = new Set<string>();
	private lastQueued: Annotation[] = [];
	private revision = 0;
	private chain: Promise<void> = Promise.resolve();
	private baselinesDirty = false;
	private baselineTimer: ReturnType<typeof setTimeout> | null = null;
	private positionTimer: ReturnType<typeof setTimeout> | null = null;
	private positionDirty = false;

	constructor(
		private readonly io: AppliedIO,
		private readonly sleep: (ms: number) => Promise<void> = (ms) =>
			new Promise((resolve) => {
				setTimeout(resolve, ms);
			}),
	) {}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	forFile(path: string): AppliedChange[] {
		const file = normalize(path);
		return this.changes.filter((item) => item.file === file);
	}

	clear(): Promise<AppliedChange[]> {
		const ids = new Set(this.changes.map((item) => item.id));
		return this.enqueue(async () => {
			const removed = this.changes.filter((item) => ids.has(item.id));
			if (removed.length === 0) return [];
			this.changes = this.changes.filter((item) => !ids.has(item.id));
			await this.persist();
			this.notify();
			return removed.map((item) => ({ ...item }));
		});
	}

	restore(changes: AppliedChange[]): Promise<void> {
		return this.enqueue(async () => {
			const present = new Set(this.changes.map((item) => item.id));
			const missing = changes.filter((item) => !present.has(item.id)).map((item) => ({ ...item }));
			if (missing.length === 0) return;
			this.changes = [...missing, ...this.changes];
			await this.persist();
			this.notify();
		});
	}

	async load(annotations: Annotation[]): Promise<void> {
		try {
			const raw = await this.io.readApplied();
			if (raw?.trim()) {
				const parsed = parseAppliedFile(raw);
				if (parsed.ok) this.changes = parsed.data.changes;
			}
		} catch (error) {
			console.error("Agent Annotations: could not read applied.json", error);
		}
		await this.healSplits();
		await this.readBaselineFile();
		this.lastQueued = annotations.map((item) => ({ ...item }));
		this.tracked = new Set(this.lastQueued.map((item) => normalize(item.file)));
		for (const file of [...this.baselines.keys()]) {
			if (!this.tracked.has(file)) {
				this.baselines.delete(file);
				this.baselinesDirty = true;
			}
		}
		await this.captureMissing([...this.tracked]);
		await this.flushBaselines();
	}

	syncQueue(snapshot: StoreSnapshot): void {
		if (snapshot.status === "error") return;
		const next = snapshot.file.annotations.map((item) => ({ ...item }));
		const prev = this.lastQueued;
		this.lastQueued = next;
		this.tracked = new Set(next.map((item) => normalize(item.file)));
		const revision = ++this.revision;
		this.chain = this.chain
			.then(() => this.process(prev, next, revision))
			.catch((error) => {
				console.error("Agent Annotations: failed to record applied changes", error);
			});
	}

	whenIdle(): Promise<void> {
		return this.chain;
	}

	seedBaseline(path: string, text: string): void {
		const file = normalize(path);
		this.tracked.add(file);
		this.baselines.set(file, text);
		this.touchBaselines();
	}

	fillIfMissing(path: string, text: string): void {
		const file = normalize(path);
		if (!this.tracked.has(file) || this.baselines.has(file)) return;
		this.baselines.set(file, text);
	}

	shiftFile(path: string, mapRange: (from: number, to: number) => TextRange): boolean {
		const file = normalize(path);
		let changed = false;
		this.changes = this.changes.map((item) => {
			if (item.file !== file || !hasRange(item)) return item;
			const next = mapRange(item.from, item.to);
			if (next.from === item.from && next.to === item.to) return item;
			changed = true;
			return { ...item, from: next.from, to: next.to };
		});
		if (changed) this.schedulePositions();
		return changed;
	}

	placeFile(path: string, doc: string): boolean {
		const file = normalize(path);
		let changed = false;
		this.changes = this.changes.map((item) => {
			if (item.file !== file || hasRange(item)) return item;
			const range = appliedRange(doc, item);
			if (!range) return item;
			changed = true;
			return { ...item, from: range.from, to: range.to };
		});
		if (changed) this.schedulePositions();
		return changed;
	}

	async flushPositions(): Promise<void> {
		if (this.positionTimer !== null) {
			clearTimeout(this.positionTimer);
			this.positionTimer = null;
		}
		if (!this.positionDirty) return;
		await this.enqueue(async () => {
			if (!this.positionDirty) return;
			this.positionDirty = false;
			try {
				await this.persist();
				this.notify();
			} catch (error) {
				this.positionDirty = true;
				console.error("Agent Annotations: could not save applied positions", error);
			}
		});
	}

	noteUserEdit(path: string, text: string): void {
		const file = normalize(path);
		if (!this.tracked.has(file)) return;
		this.baselines.set(file, text);
		this.touchBaselines();
	}

	async flushBaselines(): Promise<void> {
		if (this.baselineTimer !== null) {
			clearTimeout(this.baselineTimer);
			this.baselineTimer = null;
		}
		if (!this.baselinesDirty) return;
		this.baselinesDirty = false;
		const files: Record<string, string> = {};
		for (const [file, text] of this.baselines) files[file] = text;
		await this.io.writeBaselines(`${JSON.stringify({ version: 1, files }, null, 2)}\n`);
	}

	remapFile(oldPath: string, newPath: string): void {
		const from = normalize(oldPath);
		const to = normalize(newPath);
		if (from === to) return;

		let changed = false;
		this.changes = this.changes.map((item) => {
			if (item.file !== from) return item;
			changed = true;
			return { ...item, file: to };
		});
		this.lastQueued = this.lastQueued.map((item) =>
			item.file === from ? { ...item, file: to } : item,
		);
		let baselineMoved = false;
		if (this.baselines.has(from)) {
			const text = this.baselines.get(from);
			this.baselines.delete(from);
			if (text !== undefined) this.baselines.set(to, text);
			baselineMoved = true;
			this.baselinesDirty = true;
		}
		if (this.tracked.has(from)) {
			this.tracked.delete(from);
			this.tracked.add(to);
		}
		if (!changed && !baselineMoved) return;
		void this.enqueue(async () => {
			if (changed) {
				await this.persist();
				this.notify();
			}
			if (baselineMoved) await this.flushBaselines();
		}).catch((error) => {
			console.error("Agent Annotations: failed to rename applied changes", error);
		});
	}

	private async process(prev: Annotation[], next: Annotation[], revision: number): Promise<void> {
		await this.flushBaselines();
		const removed = removedFiles(prev, next);
		await this.captureMissing(uniqueFiles(next).filter((file) => !removed.includes(file)));
		const baselineSnapshot = new Map(this.baselines);
		if (removed.length > 0) {
			const texts = await this.readNotes(removed, baselineSnapshot);
			const gone = prev.filter((item) => !next.some((entry) => entry.id === item.id));
			const changes = this.changesFor(removed, texts, baselineSnapshot, gone);
			if (changes.length > 0) {
				const stillTracked = new Set(next.map((item) => normalize(item.file)));
				for (const file of removed) {
					const text = texts.get(file);
					if (text != null && stillTracked.has(file)) {
						this.baselines.set(file, text);
						this.baselinesDirty = true;
					}
				}
				this.changes = changes;
				await this.persist();
				this.notify();
			}
		}
		if (revision === this.revision) {
			this.pruneBaselines();
			await this.flushBaselines();
		}
	}

	private async captureMissing(files: string[]): Promise<void> {
		await Promise.all(
			files.map(async (file) => {
				if (this.baselines.has(file)) return;
				try {
					const text = await this.io.readNote(file);
					if (text != null && !this.baselines.has(file)) {
						this.baselines.set(file, text);
						this.baselinesDirty = true;
					}
				} catch {
					// A later edit can fill the gap.
				}
			}),
		);
	}

	private async readNotes(
		files: string[],
		baselines: ReadonlyMap<string, string>,
	): Promise<Map<string, string | null>> {
		const read = async (paths: string[]) => {
			const map = new Map<string, string | null>();
			await Promise.all(
				paths.map(async (file) => {
					try {
						map.set(file, await this.io.readNote(file));
					} catch {
						map.set(file, null);
					}
				}),
			);
			return map;
		};

		const texts = await read(files);
		// The note is saved before current.json. If the queue is observed first, look once more.
		const stale = files.filter((file) => {
			const baseline = baselines.get(file);
			return baseline !== undefined && texts.get(file) === baseline;
		});
		if (stale.length === 0) return texts;
		await this.sleep(APPLIED_RETRY_MS);
		const again = await read(stale);
		for (const [file, text] of again) texts.set(file, text);
		return texts;
	}

	private changesFor(
		files: string[],
		texts: Map<string, string | null>,
		baselines: ReadonlyMap<string, string>,
		annotations: Annotation[],
	): AppliedChange[] {
		const changes: AppliedChange[] = [];
		const ids: string[] = [];
		for (const file of files) {
			const baseline = baselines.get(file);
			const text = texts.get(file);
			if (baseline === undefined || text == null) continue;
			const spans: TextHunk[] = [];
			for (const item of annotations) {
				if (normalize(item.file) !== file) continue;
				const hit = anchoredReplacement(baseline, text, item);
				if (hit) spans.push(hit);
			}
			for (const hunk of diffHunks(baseline, text)) {
				if (spans.some((span) => rangesOverlap(span, hunk))) continue;
				spans.push(hunk);
			}
			spans.sort((a, b) => a.at - b.at);
			for (const hunk of spans) changes.push(this.changeFromHunk(file, text, hunk, ids));
		}
		return changes;
	}

	private changeFromHunk(file: string, text: string, hunk: TextHunk, ids: string[]): AppliedChange {
		const id = generateId(ids, "c_");
		ids.push(id);
		const end = hunk.at + hunk.after.length;
		const context = extractContext(text, hunk.at, end);
		const headingPath = headingPathFromSource(text, hunk.at);
		const change: AppliedChange = {
			id,
			file,
			before: hunk.before,
			after: hunk.after,
			from: hunk.at,
			to: end,
		};
		if (headingPath.length) change.headingPath = headingPath;
		if (context.prefix) change.prefix = context.prefix;
		if (context.suffix) change.suffix = context.suffix;
		return change;
	}

	private pruneBaselines(): void {
		for (const file of [...this.baselines.keys()]) {
			if (this.tracked.has(file)) continue;
			this.baselines.delete(file);
			this.baselinesDirty = true;
		}
	}

	private schedulePositions(): void {
		this.positionDirty = true;
		if (this.positionTimer !== null) clearTimeout(this.positionTimer);
		this.positionTimer = setTimeout(() => {
			this.positionTimer = null;
			void this.flushPositions().catch((error) => {
				this.positionDirty = true;
				console.error("Agent Annotations: could not save applied positions", error);
			});
		}, 200);
	}

	private touchBaselines(): void {
		this.baselinesDirty = true;
		if (this.baselineTimer !== null) clearTimeout(this.baselineTimer);
		this.baselineTimer = setTimeout(() => {
			this.baselineTimer = null;
			void this.flushBaselines();
		}, 400);
	}

	private async healSplits(): Promise<void> {
		const files: string[] = [];
		for (const change of this.changes) {
			if (!files.includes(change.file)) files.push(change.file);
		}
		const ids = new Set(this.changes.map((item) => item.id));
		const healed: AppliedChange[] = [];
		let changed = false;
		for (const file of files) {
			const items = this.changes.filter((item) => item.file === file);
			let doc: string | null = null;
			try {
				doc = await this.io.readNote(file);
			} catch {
				doc = null;
			}
			const placed = items.map((item) => placeChange(item, doc));
			const expanded = placed.flatMap((item) => expandChange(item, doc, ids));
			const merged = doc == null ? expanded : coalesceFile(expanded, doc);
			if (
				merged.length !== items.length ||
				merged.some(
					(item, index) =>
						item.id !== items[index]?.id ||
						item.before !== items[index]?.before ||
						item.after !== items[index]?.after ||
						item.from !== items[index]?.from ||
						item.to !== items[index]?.to,
				)
			) {
				changed = true;
			}
			healed.push(...merged);
		}
		if (!changed) return;
		this.changes = healed;
		await this.persist();
	}

	private async readBaselineFile(): Promise<void> {
		try {
			const raw = await this.io.readBaselines();
			if (!raw?.trim()) return;
			const parsed: unknown = JSON.parse(raw);
			if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.files)) return;
			for (const [file, text] of Object.entries(parsed.files)) {
				if (typeof text === "string") this.baselines.set(normalize(file), text);
			}
		} catch (error) {
			console.error("Agent Annotations: could not read baselines.json", error);
		}
	}

	private enqueue<T>(task: () => Promise<T>): Promise<T> {
		const run = this.chain.then(task);
		this.chain = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	private async persist(): Promise<void> {
		await this.io.writeApplied(serializeAppliedFile({ version: 1, changes: this.changes }));
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}
}

function placeChange(change: AppliedChange, doc: string | null): AppliedChange {
	if (hasRange(change) || !doc) return change;
	const range = appliedRange(doc, change);
	if (!range) return change;
	return { ...change, from: range.from, to: range.to };
}

function rangesOverlap(a: TextHunk, b: TextHunk): boolean {
	const aEnd = a.at + a.after.length;
	const bEnd = b.at + b.after.length;
	if (a.at === aEnd) return a.at >= b.at && a.at <= bEnd;
	if (b.at === bEnd) return b.at >= a.at && b.at <= aEnd;
	return a.at < bEnd && b.at < aEnd;
}

function coalesceFile(changes: AppliedChange[], doc: string): AppliedChange[] {
	const merged: AppliedChange[] = [];
	for (const change of changes) {
		const prev = merged[merged.length - 1];
		const prevRange = prev ? appliedRange(doc, prev) : null;
		const range = appliedRange(doc, change);
		if (!prev || !prevRange || !range || range.from < prevRange.to) {
			merged.push(change);
			continue;
		}
		const gap = doc.slice(prevRange.to, range.from);
		// Only stitch fragments of one rewrite. A real gap between edits stays split.
		if (gap.includes("\n") || gap.includes("\r") || gap.length > 4) {
			merged.push(change);
			continue;
		}
		const from = prevRange.from;
		const to = range.to;
		const context = extractContext(doc, from, to);
		const headingPath = headingPathFromSource(doc, from);
		const next: AppliedChange = {
			id: prev.id,
			file: prev.file,
			before: prev.before + gap + change.before,
			after: doc.slice(from, to),
			from,
			to,
		};
		if (headingPath.length) next.headingPath = headingPath;
		if (context.prefix) next.prefix = context.prefix;
		if (context.suffix) next.suffix = context.suffix;
		merged[merged.length - 1] = next;
	}
	return merged;
}

function expandChange(change: AppliedChange, doc: string | null, ids: Set<string>): AppliedChange[] {
	const hunks = diffHunks(change.before, change.after);
	if (hunks.length <= 1) return [change];
	const located = doc ? appliedRange(doc, change) : null;
	return hunks.map((hunk, index) => {
		const id = index === 0 ? change.id : generateId(ids, "c_");
		ids.add(id);
		const next: AppliedChange = {
			id,
			file: change.file,
			before: hunk.before,
			after: hunk.after,
			from: -1,
			to: -1,
		};
		if (doc && located) {
			const from = located.from + hunk.at;
			const to = from + hunk.after.length;
			next.from = from;
			next.to = to;
			const context = extractContext(doc, from, to);
			const headingPath = headingPathFromSource(doc, from);
			if (headingPath.length) next.headingPath = headingPath;
			if (context.prefix) next.prefix = context.prefix;
			if (context.suffix) next.suffix = context.suffix;
			return next;
		}
		const from = hunk.at;
		const to = from + hunk.after.length;
		const prefix = (
			(index === 0 ? (change.prefix ?? "") : "") + change.after.slice(Math.max(0, from - CONTEXT_RADIUS), from)
		).slice(-CONTEXT_RADIUS);
		const suffix = (
			change.after.slice(to, to + CONTEXT_RADIUS) +
			(index === hunks.length - 1 ? (change.suffix ?? "") : "")
		).slice(0, CONTEXT_RADIUS);
		if (index === 0 && change.headingPath?.length) next.headingPath = [...change.headingPath];
		if (prefix) next.prefix = prefix;
		if (suffix) next.suffix = suffix;
		return next;
	});
}

function removedFiles(prev: Annotation[], next: Annotation[]): string[] {
	const nextIds = new Set(next.map((item) => item.id));
	const files: string[] = [];
	for (const item of prev) {
		if (nextIds.has(item.id)) continue;
		const file = normalize(item.file);
		if (!files.includes(file)) files.push(file);
	}
	return files;
}

function uniqueFiles(annotations: Annotation[]): string[] {
	const files: string[] = [];
	for (const item of annotations) {
		const file = normalize(item.file);
		if (!files.includes(file)) files.push(file);
	}
	return files;
}

function normalize(path: string): string {
	return path.replace(/\\/g, "/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
