import { FileSystemAdapter, type App } from "obsidian";
import type { FSWatcher } from "fs";
import { STORE_DIR_NAME, STORE_FILE_NAME } from "./constants";
import { generateId } from "./ids";
import {
	emptyAnnotationFile,
	parseAnnotationFile,
	serializeAnnotationFile,
} from "./schema";
import { sameAnchor } from "./locate";
import type { Annotation, AnnotationFile } from "./types";

export type StoreListener = () => void;

export interface StoreSnapshot {
	status: "ok" | "error";
	file: AnnotationFile;
	error: string | null;
	exists: boolean;
}

export class AnnotationStore {
	private readonly listeners = new Set<StoreListener>();
	private file: AnnotationFile = emptyAnnotationFile();
	private error: string | null = null;
	private exists = false;
	private watcher: FSWatcher | null = null;
	private pollId: number | null = null;
	private lastRaw = "";
	private lastMtime = 0;
	private ignoreWatchUntil = 0;
	private reloadTimer: number | null = null;

	constructor(private readonly app: App) {}

	get dirPath(): string {
		return `${this.app.vault.configDir}/${STORE_DIR_NAME}`;
	}

	get filePath(): string {
		return `${this.dirPath}/${STORE_FILE_NAME}`;
	}

	get snapshot(): StoreSnapshot {
		return {
			status: this.error ? "error" : "ok",
			file: this.file,
			error: this.error,
			exists: this.exists,
		};
	}

	get annotations(): Annotation[] {
		return this.file.annotations;
	}

	subscribe(listener: StoreListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	forFile(path: string): Annotation[] {
		const normalized = path.replace(/\\/g, "/");
		return this.file.annotations.filter((item) => item.file === normalized);
	}

	countForFile(path: string): number {
		return this.forFile(path).length;
	}

	async load(): Promise<void> {
		await this.reload();
	}

	startWatching(): void {
		this.stopWatching();
		const adapter = this.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			void this.ensureDir().then(() => this.startFsWatch(adapter));
		}
		this.pollId = window.setInterval(() => {
			void this.reloadIfChanged();
		}, 1000);
	}

	stopWatching(): void {
		this.watcher?.close();
		this.watcher = null;
		if (this.pollId !== null) {
			window.clearInterval(this.pollId);
			this.pollId = null;
		}
		if (this.reloadTimer !== null) {
			window.clearTimeout(this.reloadTimer);
			this.reloadTimer = null;
		}
	}

	async add(input: Omit<Annotation, "id"> & { id?: string }): Promise<Annotation> {
		this.assertWritable();
		const annotation: Annotation = {
			...input,
			id: input.id ?? generateId(this.file.annotations.map((item) => item.id)),
			file: input.file.replace(/\\/g, "/"),
		};
		if (this.file.annotations.some((item) => sameAnchor(item, annotation))) {
			throw new Error("This text already has an annotation");
		}
		this.file = {
			version: 1,
			annotations: [...this.file.annotations, annotation],
		};
		await this.persist();
		return annotation;
	}

	async updateInstruction(id: string, instruction: string): Promise<void> {
		this.assertWritable();
		this.file = {
			version: 1,
			annotations: this.file.annotations.map((item) =>
				item.id === id ? { ...item, instruction } : item,
			),
		};
		await this.persist();
	}

	async remove(id: string): Promise<Annotation | null> {
		this.assertWritable();
		const removed = this.file.annotations.find((item) => item.id === id) ?? null;
		this.file = {
			version: 1,
			annotations: this.file.annotations.filter((item) => item.id !== id),
		};
		await this.persist();
		return removed;
	}

	async restore(annotation: Annotation, index?: number): Promise<void> {
		this.assertWritable();
		if (this.file.annotations.some((item) => item.id === annotation.id)) return;
		const next = [...this.file.annotations];
		if (index === undefined || index < 0 || index > next.length) {
			next.push(annotation);
		} else {
			next.splice(index, 0, annotation);
		}
		this.file = { version: 1, annotations: next };
		await this.persist();
	}

	async replaceAll(annotations: Annotation[]): Promise<void> {
		this.assertWritable();
		this.file = { version: 1, annotations: [...annotations] };
		await this.persist();
	}

	async clearFile(path: string): Promise<Annotation[]> {
		this.assertWritable();
		const normalized = path.replace(/\\/g, "/");
		const removed = this.file.annotations.filter((item) => item.file === normalized);
		this.file = {
			version: 1,
			annotations: this.file.annotations.filter((item) => item.file !== normalized),
		};
		await this.persist();
		return removed;
	}

	async clearAll(): Promise<Annotation[]> {
		this.assertWritable();
		const removed = [...this.file.annotations];
		this.file = emptyAnnotationFile();
		await this.persist();
		return removed;
	}

	async remapFile(oldPath: string, newPath: string): Promise<void> {
		if (this.error) return;
		const from = oldPath.replace(/\\/g, "/");
		const to = newPath.replace(/\\/g, "/");
		if (from === to) return;
		let changed = false;
		const annotations = this.file.annotations.map((item) => {
			if (item.file !== from) return item;
			changed = true;
			return { ...item, file: to };
		});
		if (!changed) return;
		this.file = { version: 1, annotations };
		await this.persist();
	}

	private assertWritable(): void {
		if (this.error) {
			throw new Error(`current.json is invalid: ${this.error}`);
		}
	}

	private startFsWatch(adapter: FileSystemAdapter): void {
		try {
			const nodeRequire = (window as unknown as { require?: (id: string) => typeof import("fs") })
				.require;
			if (!nodeRequire) return;
			this.watcher = nodeRequire("fs").watch(
				adapter.getFullPath(this.dirPath),
				{ persistent: false },
				() => this.scheduleReload(),
			);
		} catch {
			// Polling still covers external writes.
		}
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}

	private scheduleReload(): void {
		this.scheduleReloadIn(80);
	}

	private scheduleReloadIn(ms: number): void {
		if (this.reloadTimer !== null) window.clearTimeout(this.reloadTimer);
		this.reloadTimer = window.setTimeout(() => {
			this.reloadTimer = null;
			void this.reload();
		}, Math.max(0, ms));
	}

	private async reloadIfChanged(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const exists = await adapter.exists(this.filePath);
		if (!exists) {
			if (this.exists || this.file.annotations.length > 0 || this.error) {
				await this.reload();
			}
			return;
		}
		const stat = await adapter.stat(this.filePath);
		const mtime = stat?.mtime ?? 0;
		if (mtime !== this.lastMtime) await this.reload();
	}

	private async reload(): Promise<void> {
		const wait = this.ignoreWatchUntil - Date.now();
		if (wait > 0) {
			this.scheduleReloadIn(wait + 20);
			return;
		}

		const adapter = this.app.vault.adapter;
		const exists = await adapter.exists(this.filePath);
		if (!exists) {
			const wasEmpty = !this.exists && this.file.annotations.length === 0 && !this.error;
			this.exists = false;
			this.lastRaw = "";
			this.lastMtime = 0;
			this.error = null;
			this.file = emptyAnnotationFile();
			if (!wasEmpty) this.notify();
			return;
		}

		const raw = await adapter.read(this.filePath);
		if (raw === this.lastRaw && !this.error) return;

		const stat = await adapter.stat(this.filePath);
		this.lastMtime = stat?.mtime ?? Date.now();
		this.lastRaw = raw;
		this.exists = true;

		const parsed = parseAnnotationFile(raw);
		if (!parsed.ok) {
			this.error = parsed.error;
			this.file = emptyAnnotationFile();
			this.notify();
			return;
		}

		this.error = null;
		this.file = parsed.data;
		this.notify();
	}

	private async persist(): Promise<void> {
		await this.ensureDir();
		const content = serializeAnnotationFile(this.file);
		this.ignoreWatchUntil = Date.now() + 400;
		this.lastRaw = content;
		this.error = null;
		this.exists = true;
		const adapter = this.app.vault.adapter;
		const tmp = `${this.filePath}.tmp`;
		try {
			await adapter.write(tmp, content);
		} catch {
			// Destination write below is the source of truth.
		}
		await adapter.write(this.filePath, content);
		if (await adapter.exists(tmp)) await adapter.remove(tmp);
		const stat = await adapter.stat(this.filePath);
		this.lastMtime = stat?.mtime ?? Date.now();
		this.notify();
	}

	private async ensureDir(): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.dirPath))) {
			await adapter.mkdir(this.dirPath);
		}
	}
}
