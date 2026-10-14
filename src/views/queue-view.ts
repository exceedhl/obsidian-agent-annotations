import { ItemView, Menu, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_QUEUE } from "../constants";
import type AgentAnnotationsPlugin from "../main";
import { showUndoNotice } from "../ui/undo-notice";
import type { Annotation, AppliedChange } from "../types";

type QueueTab = "pending" | "applied";

export class QueueView extends ItemView {
	private unsub: (() => void) | null = null;
	private unsubApplied: (() => void) | null = null;
	private readonly collapsed = new Set<string>();
	private tab: QueueTab = "pending";

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: AgentAnnotationsPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_QUEUE;
	}

	getDisplayText(): string {
		return "Annotations";
	}

	getIcon(): string {
		return "list-todo";
	}

	async onOpen(): Promise<void> {
		this.unsub = this.plugin.store.subscribe(() => this.render());
		this.unsubApplied = this.plugin.applied.subscribe(() => this.render());
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsub?.();
		this.unsubApplied?.();
		this.unsub = null;
		this.unsubApplied = null;
	}

	onPaneMenu(menu: Menu, source: string): void {
		super.onPaneMenu(menu, source);
		const locked = this.plugin.store.snapshot.status === "error";
		const empty = this.plugin.store.annotations.length === 0;
		menu.addItem((item) => {
			item
				.setTitle("Clear pending")
				.setIcon("trash")
				.setDisabled(locked || empty)
				.onClick(() => void this.clearAll());
		});
		menu.addItem((item) => {
			item
				.setTitle("Clear applied")
				.setIcon("check-check")
				.setDisabled(this.plugin.applied.changes.length === 0)
				.onClick(() => void this.clearApplied());
		});
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("aa-queue");

		const snapshot = this.plugin.store.snapshot;
		const annotations = snapshot.file.annotations;
		const changes = this.plugin.applied.changes;
		const locked = snapshot.status === "error";

		this.renderTabs(root, annotations.length, changes.length, this.tab === "applied" && changes.length > 0);

		if (locked) {
			root.createDiv({
				cls: "aa-queue-error",
				text: `current.json is invalid: ${snapshot.error}. The file was not modified.`,
			});
		}

		if (this.tab === "applied") {
			this.renderApplied(root, changes);
			return;
		}

		if (annotations.length > 0) {
			for (const [file, items] of groupBy(annotations)) {
				const group = root.createDiv({ cls: "tree-item" });
				if (this.collapsed.has(file)) group.addClass("is-collapsed");

				const header = group.createDiv({
					cls: "tree-item-self is-clickable mod-collapsible",
				});
				header.setAttribute("title", file);
				header.tabIndex = 0;

				const twisty = header.createDiv({ cls: "tree-item-icon collapse-icon" });
				setIcon(twisty, "right-triangle");
				twisty.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					this.toggleCollapsed(file);
				});

				const missing = !this.plugin.fileExists(file);
				header.createEl("div", {
					cls: "tree-item-inner",
					text: missing ? `${noteTitle(file)} (missing)` : noteTitle(file),
				});
				header
					.createEl("div", { cls: "tree-item-flair-outer" })
					.createEl("span", { cls: "tree-item-flair", text: String(items.length) });

				header.addEventListener("click", () => void this.plugin.revealFile(file));
				header.addEventListener("keydown", (event) => {
					if (event.key === "Enter") void this.plugin.revealFile(file);
					if (event.key === "ArrowRight" && this.collapsed.has(file)) this.toggleCollapsed(file);
					if (event.key === "ArrowLeft" && !this.collapsed.has(file)) this.toggleCollapsed(file);
				});
				header.addEventListener("contextmenu", (event) => {
					event.preventDefault();
					const menu = new Menu();
					menu.addItem((item) => {
						item.setTitle("Open").setIcon("link").onClick(() => void this.plugin.revealFile(file));
					});
					menu.addItem((item) => {
						item
							.setTitle("Clear file")
							.setIcon("trash")
							.setDisabled(locked)
							.onClick(() => void this.clearFile(file));
					});
					menu.showAtMouseEvent(event);
				});

				const children = group.createDiv({ cls: "tree-item-children" });
				for (const annotation of items) {
					this.renderItem(children, annotation, locked);
				}
			}
		}

		if (annotations.length === 0) {
			root.createDiv({
				cls: "pane-empty",
				text: locked
					? "Fix the JSON file to use the queue again."
					: "Select text in a note, then add an annotation.",
			});
		}
	}

	private renderTabs(
		root: HTMLElement,
		pendingCount: number,
		appliedCount: number,
		showClear: boolean,
	): void {
		const head = root.createDiv({ cls: "aa-queue-head" });
		const tabs = head.createDiv({ cls: "aa-queue-tabs" });
		tabs.setAttribute("role", "tablist");
		this.renderTab(tabs, "pending", "Pending", pendingCount);
		this.renderTab(tabs, "applied", "Applied", appliedCount);
		tabs.addEventListener("keydown", (event) => {
			if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
			event.preventDefault();
			this.tab = this.tab === "pending" ? "applied" : "pending";
			this.render();
			this.contentEl.querySelector<HTMLButtonElement>(".aa-queue-tab.is-active")?.focus();
		});
		if (!showClear) return;

		const clear = head.createEl("button", { cls: "aa-queue-clear" });
		clear.type = "button";
		clear.setAttribute("aria-label", "Clear applied changes");
		setIcon(clear.createSpan({ cls: "aa-queue-clear-icon" }), "check-check");
		clear.createSpan({ text: "Clear all" });
		clear.addEventListener("click", () => void this.clearApplied());
	}

	private renderTab(parent: HTMLElement, id: QueueTab, label: string, count: number): void {
		const button = parent.createEl("button", { cls: "aa-queue-tab" });
		button.type = "button";
		button.setAttribute("role", "tab");
		button.setAttribute("aria-selected", this.tab === id ? "true" : "false");
		if (this.tab === id) button.addClass("is-active");
		button.createSpan({ text: label });
		if (count > 0) button.createSpan({ cls: "aa-queue-tab-count", text: String(count) });
		button.addEventListener("click", () => {
			if (this.tab === id) return;
			this.tab = id;
			this.render();
		});
	}

	private renderApplied(root: HTMLElement, changes: AppliedChange[]): void {
		if (changes.length === 0) {
			root.createDiv({
				cls: "pane-empty",
				text: "Applied changes show up here after an agent edit.",
			});
			return;
		}

		for (const [file, items] of groupBy(changes)) {
			this.renderChangeGroup(root, file, items);
		}
	}

	private renderChangeGroup(root: HTMLElement, file: string, items: AppliedChange[]): void {
		const key = `change:${file}`;
		const group = root.createDiv({ cls: "tree-item" });
		if (this.collapsed.has(key)) group.addClass("is-collapsed");

		const header = group.createDiv({
			cls: "tree-item-self is-clickable mod-collapsible",
		});
		header.setAttribute("title", file);
		header.tabIndex = 0;

		const twisty = header.createDiv({ cls: "tree-item-icon collapse-icon" });
		setIcon(twisty, "right-triangle");
		twisty.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.toggleCollapsed(key);
		});

		const missing = !this.plugin.fileExists(file);
		header.createEl("div", {
			cls: "tree-item-inner",
			text: missing ? `${noteTitle(file)} (missing)` : noteTitle(file),
		});
		header
			.createEl("div", { cls: "tree-item-flair-outer" })
			.createEl("span", { cls: "tree-item-flair", text: String(items.length) });

		const open = () => {
			const first = items[0];
			if (first) void this.plugin.revealChange(first);
		};
		header.addEventListener("click", open);
		header.addEventListener("keydown", (event) => {
			if (event.key === "Enter") open();
			if (event.key === "ArrowRight" && this.collapsed.has(key)) this.toggleCollapsed(key);
			if (event.key === "ArrowLeft" && !this.collapsed.has(key)) this.toggleCollapsed(key);
		});

		const children = group.createDiv({ cls: "tree-item-children" });
		for (const change of items) this.renderChange(children, change);
	}

	private renderChange(parent: HTMLElement, change: AppliedChange): void {
		const item = parent.createDiv({ cls: "tree-item" });
		const row = item.createDiv({ cls: "tree-item-self is-clickable aa-queue-item" });
		row.tabIndex = 0;
		const label = appliedLabel(change);
		const was = appliedWas(change);
		if (was) {
			row.setAttribute("title", was);
			row.setAttribute("aria-label", was);
		}

		const mark = row.createDiv({ cls: "aa-queue-applied-icon" });
		setIcon(mark, "check");

		const inner = row.createDiv({ cls: "tree-item-inner aa-queue-item-inner" });
		inner.createDiv({ cls: "aa-queue-text aa-queue-change", text: label });
		if (was) inner.createDiv({ cls: "aa-queue-was", text: was });

		const open = () => void this.plugin.revealChange(change);
		row.addEventListener("click", open);
		row.addEventListener("keydown", (event) => {
			if (event.key === "Enter") open();
		});
	}

	private renderItem(parent: HTMLElement, annotation: Annotation, locked: boolean): void {
		const item = parent.createDiv({ cls: "tree-item" });
		const row = item.createDiv({ cls: "tree-item-self is-clickable aa-queue-item" });
		row.tabIndex = 0;

		const inner = row.createDiv({ cls: "tree-item-inner aa-queue-item-inner" });
		inner.createDiv({ cls: "aa-queue-text", text: annotation.instruction });
		if (annotation.selectedText) {
			inner.createDiv({ cls: "aa-queue-quote", text: annotation.selectedText });
		}

		const remove = row.createEl("button", { cls: "clickable-icon aa-queue-remove" });
		remove.setAttribute("aria-label", "Delete annotation");
		remove.disabled = locked;
		setIcon(remove, "trash");
		remove.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			if (!locked) void this.remove(annotation);
		});

		row.addEventListener("click", () => void this.plugin.revealAnnotation(annotation));
		row.addEventListener("keydown", (event) => {
			if (event.key === "Enter") void this.plugin.revealAnnotation(annotation);
			if ((event.key === "Delete" || event.key === "Backspace") && !locked) {
				event.preventDefault();
				void this.remove(annotation);
			}
		});
		row.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			const menu = new Menu();
			menu.addItem((entry) => {
				entry
					.setTitle("Open")
					.setIcon("link")
					.onClick(() => void this.plugin.revealAnnotation(annotation));
			});
			menu.addItem((entry) => {
				entry
					.setTitle("Delete")
					.setIcon("trash")
					.setDisabled(locked)
					.onClick(() => void this.remove(annotation));
			});
			menu.showAtMouseEvent(event);
		});
	}

	private toggleCollapsed(file: string): void {
		if (this.collapsed.has(file)) this.collapsed.delete(file);
		else this.collapsed.add(file);
		this.render();
	}

	private async remove(item: Annotation): Promise<void> {
		const index = this.plugin.store.annotations.findIndex((entry) => entry.id === item.id);
		try {
			await this.plugin.store.remove(item.id);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not delete annotation");
			return;
		}
		showUndoNotice("Deleted annotation", () => {
			void this.plugin.store.restore(item, index);
		});
	}

	private async clearFile(path: string): Promise<void> {
		try {
			const removed = await this.plugin.store.clearFile(path);
			if (removed.length === 0) return;
			showUndoNotice("Cleared file annotations", () => {
				void this.plugin.restoreMany(removed);
			});
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not clear file annotations");
		}
	}

	private async clearApplied(): Promise<void> {
		try {
			const removed = await this.plugin.applied.clear();
			if (removed.length === 0) return;
			showUndoNotice("Cleared applied changes", () => {
				void this.plugin.applied.restore(removed);
			});
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not clear applied changes");
		}
	}

	private async clearAll(): Promise<void> {
		try {
			const removed = await this.plugin.store.clearAll();
			if (removed.length === 0) return;
			showUndoNotice("Cleared annotations", () => {
				void this.plugin.restoreMany(removed);
			});
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not clear annotations");
		}
	}
}

function noteTitle(path: string): string {
	const name = path.split("/").pop() || path;
	return name.replace(/\.md$/i, "");
}

function groupBy<T extends { file: string }>(items: T[]): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const list = groups.get(item.file) ?? [];
		list.push(item);
		groups.set(item.file, list);
	}
	return groups;
}

function appliedLabel(change: AppliedChange): string {
	const after = oneLine(change.after);
	if (after) return after;
	const before = oneLine(change.before);
	return before ? `Removed: ${before}` : "Removed";
}

function appliedWas(change: AppliedChange): string {
	const before = oneLine(change.before);
	if (!before || !oneLine(change.after)) return "";
	return `Was: ${before}`;
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}
