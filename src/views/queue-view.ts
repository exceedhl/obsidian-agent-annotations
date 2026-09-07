import { ItemView, Menu, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_QUEUE } from "../constants";
import type AgentAnnotationsPlugin from "../main";
import { showUndoNotice } from "../ui/undo-notice";
import type { Annotation } from "../types";

export class QueueView extends ItemView {
	private unsub: (() => void) | null = null;
	private readonly collapsed = new Set<string>();

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
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsub?.();
		this.unsub = null;
	}

	onPaneMenu(menu: Menu, source: string): void {
		super.onPaneMenu(menu, source);
		const locked = this.plugin.store.snapshot.status === "error";
		const empty = this.plugin.store.annotations.length === 0;
		menu.addItem((item) => {
			item
				.setTitle("Clear all")
				.setIcon("trash")
				.setDisabled(locked || empty)
				.onClick(() => void this.clearAll());
		});
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("aa-queue");

		const snapshot = this.plugin.store.snapshot;
		const annotations = snapshot.file.annotations;
		const locked = snapshot.status === "error";

		if (locked) {
			root.createDiv({
				cls: "aa-queue-error",
				text: `current.json is invalid: ${snapshot.error}. The file was not modified.`,
			});
		}

		if (annotations.length === 0) {
			root.createDiv({
				cls: "pane-empty",
				text: locked
					? "Fix the JSON file to use the queue again."
					: "Select text in a note, then add an annotation.",
			});
			return;
		}

		for (const [file, items] of groupByFile(annotations)) {
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
			header.createDiv({
				cls: "tree-item-inner",
				text: missing ? `${noteTitle(file)} (missing)` : noteTitle(file),
			});
			header
				.createDiv({ cls: "tree-item-flair-outer" })
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

function groupByFile(annotations: Annotation[]): Map<string, Annotation[]> {
	const groups = new Map<string, Annotation[]>();
	for (const item of annotations) {
		const list = groups.get(item.file) ?? [];
		list.push(item);
		groups.set(item.file, list);
	}
	return groups;
}
