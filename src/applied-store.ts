import { APPLIED_FILE_NAME, APPLIED_RETRY_MS, BASELINES_FILE_NAME, STORE_DIR_NAME } from "./constants";
import { diffHunks } from "./diff";
import { headingPathFromSource } from "./headings";
import { generateId } from "./ids";
import { extractContext, locateApplied } from "./locate";
import { parseAppliedFile, serializeAppliedFile } from "./applied-schema";
import type { StoreSnapshot } from "./store";
import type { Annotation, AppliedChange } from "./types";
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
			const changes = this.changesFor(removed, texts, baselineSnapshot);
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
	): AppliedChange[] {
		const changes: AppliedChange[] = [];
		const ids: string[] = [];
		for (const file of files) {
			const baseline = baselines.get(file);
			const text = texts.get(file);
			if (baseline === undefined || text == null) continue;
			for (const hunk of diffHunks(baseline, text)) {
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
				};
				if (headingPath.length) change.headingPath = headingPath;
				if (context.prefix) change.prefix = context.prefix;
				if (context.suffix) change.suffix = context.suffix;
				changes.push(change);
			}
		}
		return changes;
	}

	private pruneBaselines(): void {
		for (const file of [...this.baselines.keys()]) {
			if (this.tracked.has(file)) continue;
			this.baselines.delete(file);
			this.baselinesDirty = true;
		}
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
		const healed: AppliedChange[] = [];
		let changed = false;
		for (const file of files) {
			const items = this.changes.filter((item) => item.file === file);
			if (items.length < 2) {
				healed.push(...items);
				continue;
			}
			let doc: string | null = null;
			try {
				doc = await this.io.readNote(file);
			} catch {
				doc = null;
			}
			const merged = doc == null ? items : coalesceFile(items, doc);
			if (
				merged.length !== items.length ||
				merged.some(
					(item, index) => item.before !== items[index]?.before || item.after !== items[index]?.after,
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

function coalesceFile(changes: AppliedChange[], doc: string): AppliedChange[] {
	const merged: AppliedChange[] = [];
	for (const change of changes) {
		const prev = merged[merged.length - 1];
		const prevRange = prev ? locateApplied(doc, prev) : null;
		const range = locateApplied(doc, change);
		if (!prev || !prevRange || !range || range.from < prevRange.to) {
			merged.push(change);
			continue;
		}
		const gap = doc.slice(prevRange.to, range.from);
		const from = prevRange.from;
		const to = range.to;
		const context = extractContext(doc, from, to);
		const headingPath = headingPathFromSource(doc, from);
		const next: AppliedChange = {
			id: prev.id,
			file: prev.file,
			before: prev.before + gap + change.before,
			after: doc.slice(from, to),
		};
		if (headingPath.length) next.headingPath = headingPath;
		if (context.prefix) next.prefix = context.prefix;
		if (context.suffix) next.suffix = context.suffix;
		merged[merged.length - 1] = next;
	}
	return merged;
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
