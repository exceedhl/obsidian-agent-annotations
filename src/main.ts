import { EditorView } from "@codemirror/view";
import {
	MarkdownView,
	Notice,
	Plugin,
	TFile,
	type Editor,
	type MarkdownFileInfo,
	type Menu,
} from "obsidian";
import { FLASH_MS, VIEW_TYPE_QUEUE } from "./constants";
import { filePathFromView, getEditorView, resolveEditorView, selectionOffsets } from "./editor/cm";
import { annotationsDecoField } from "./editor/decorations";
import {
	editorUiField,
	refreshDecorationsEffect,
	setDraftEffect,
	setEditingEffect,
	setFlashEffect,
} from "./editor/state";
import { selectionToolbarPlugin } from "./editor/toolbar";
import { headingPathFromSource } from "./headings";
import type { AnnotationHost } from "./host";
import { annotationHostFacet } from "./host";
import { annotationAtRange, extractContext, locateSelection } from "./locate";
import { DEFAULT_SETTINGS, mergeSettings, type PluginSettings } from "./settings";
import { AnnotationStore } from "./store";
import type { Annotation, DraftAnnotation } from "./types";
import { clearFileBadge, updateFileBadge } from "./ui/file-badge";
import { AgentAnnotationsSettingTab } from "./ui/settings-tab";
import { showUndoNotice } from "./ui/undo-notice";
import { QueueView } from "./views/queue-view";

export default class AgentAnnotationsPlugin extends Plugin implements AnnotationHost {
	store!: AnnotationStore;
	settings: PluginSettings = { ...DEFAULT_SETTINGS };
	private statusBarEl: HTMLElement | null = null;

	async onload(): Promise<void> {
		this.settings = mergeSettings(await this.loadData());

		this.store = new AnnotationStore(this.app);
		await this.store.load();
		this.store.startWatching();

		this.registerEditorExtension([
			annotationHostFacet.of(this),
			editorUiField,
			annotationsDecoField,
			selectionToolbarPlugin,
		]);

		this.addSettingTab(new AgentAnnotationsSettingTab(this.app, this));

		this.registerView(VIEW_TYPE_QUEUE, (leaf) => new QueueView(leaf, this));

		this.addRibbonIcon("list-todo", "Agent Annotations", () => {
			void this.activateQueue();
		});

		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.addClass("aa-status");
		this.statusBarEl.addEventListener("click", () => void this.activateQueue());
		this.updateStatusBar();

		this.addCommand({
			id: "toggle-review-mode",
			name: "Toggle Review mode",
			callback: () => void this.setReviewMode(!this.settings.reviewMode),
		});

		this.addCommand({
			id: "open-review-queue",
			name: "Open annotations pane",
			callback: () => void this.activateQueue(),
		});

		this.addCommand({
			id: "add-agent-instruction",
			name: "Add annotation",
			editorCallback: (editor, ctx) => {
				this.startInstructionFromEditor(editor, ctx);
			},
		});

		this.addCommand({
			id: "end-session",
			name: "End session (clear all annotations)",
			callback: () => void this.endSession(),
		});

		this.registerEvent(
			this.app.workspace.on(
				"editor-menu",
				(menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
					const range = selectionOffsets(editor);
					if (!range) return;
					const file = info.file?.path;
					if (
						file &&
						annotationAtRange(editor.getValue(), this.store.forFile(file), range.from, range.to)
					) {
						return;
					}
					menu.addItem((item) => {
						item
							.setTitle("Add annotation")
							.setIcon("message-square")
							.onClick(() => {
								this.startInstructionFromEditor(editor, info, range);
							});
					});
				},
			),
		);

		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile) void this.store.remapFile(oldPath, file.path);
			}),
		);

		this.registerEvent(this.app.workspace.on("file-open", () => this.refreshBadges()));
		this.registerEvent(this.app.workspace.on("layout-change", () => this.refreshBadges()));

		this.store.subscribe(() => {
			this.updateStatusBar();
			this.refreshBadges();
			this.refreshEditors();
		});

		this.app.workspace.onLayoutReady(() => {
			this.refreshBadges();
			void this.activateQueue();
		});
	}

	onunload(): void {
		this.store.stopWatching();
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (leaf.view instanceof MarkdownView) clearFileBadge(leaf.view);
		}
	}

	isReviewMode(): boolean {
		return this.settings.reviewMode;
	}

	saveHotkey(): string {
		return this.settings.saveHotkey;
	}

	cancelHotkey(): string {
		return this.settings.cancelHotkey;
	}

	async persistSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async setReviewMode(on: boolean): Promise<void> {
		if (this.settings.reviewMode === on) return;
		this.settings.reviewMode = on;
		await this.persistSettings();
		this.refreshEditors();
		this.refreshBadges();
		new Notice(on ? "Review mode on" : "Review mode off");
	}

	filePathOf(view: EditorView): string | null {
		return filePathFromView(view);
	}

	fileExists(path: string): boolean {
		return this.app.vault.getAbstractFileByPath(path) instanceof TFile;
	}

	startInstructionFromEditor(
		editor: Editor,
		info?: MarkdownView | MarkdownFileInfo,
		range = selectionOffsets(editor),
	): void {
		if (!range) {
			new Notice("Select some text first");
			return;
		}
		const cm = resolveEditorView(editor, info);
		if (!cm) {
			new Notice("Could not open an annotation in this editor.");
			return;
		}
		try {
			this.beginDraft(cm, range);
		} catch (error) {
			console.error("Agent Annotations: failed to start draft", error);
			new Notice(error instanceof Error ? error.message : "Could not start annotation");
		}
	}

	beginDraft(view: EditorView, range?: { from: number; to: number }): void {
		const main = view.state.selection.main;
		const from = range?.from ?? main.from;
		const to = range?.to ?? main.to;
		if (from === to) {
			new Notice("Select some text first");
			return;
		}
		const doc = view.state.doc.toString();
		if (from < 0 || to > doc.length || from > to) {
			new Notice("Could not use that selection.");
			return;
		}
		const file = this.filePathOf(view);
		if (file && annotationAtRange(doc, this.store.forFile(file), from, to)) {
			new Notice("This text already has an annotation");
			if (!this.settings.reviewMode) void this.setReviewMode(true);
			return;
		}
		const draft: DraftAnnotation = {
			from,
			to,
			selectedText: doc.slice(from, to),
			headingPath: headingPathFromSource(doc, from),
			...extractContext(doc, from, to),
		};
		view.dispatch({
			effects: [setDraftEffect.of(draft), EditorView.scrollIntoView(to, { y: "nearest" })],
		});
	}

	cancelDraft(view: EditorView): void {
		view.dispatch({ effects: setDraftEffect.of(null) });
	}

	async saveDraft(view: EditorView, instruction: string): Promise<void> {
		const draft = view.state.field(editorUiField).draft;
		const file = this.filePathOf(view);
		const text = instruction.trim();
		if (!draft) {
			new Notice("No draft annotation to save");
			return;
		}
		if (!file) {
			new Notice("This editor is not tied to a vault file.");
			return;
		}
		if (!text) {
			new Notice("Write an annotation before saving");
			return;
		}
		const doc = view.state.doc.toString();
		if (draft.from < 0 || draft.to > doc.length || draft.from >= draft.to) {
			new Notice("Could not use that selection.");
			view.dispatch({ effects: setDraftEffect.of(null) });
			return;
		}
		if (annotationAtRange(doc, this.store.forFile(file), draft.from, draft.to)) {
			new Notice("This text already has an annotation");
			view.dispatch({ effects: setDraftEffect.of(null) });
			return;
		}

		if (!this.settings.reviewMode) {
			this.settings.reviewMode = true;
			await this.persistSettings();
		}

		try {
			await this.store.add({
				file,
				instruction: text,
				selectedText: doc.slice(draft.from, draft.to),
				headingPath: headingPathFromSource(doc, draft.from),
				...extractContext(doc, draft.from, draft.to),
			});
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not save annotation");
			return;
		}

		view.dispatch({ effects: setDraftEffect.of(null) });
	}

	setEditing(view: EditorView, id: string | null): void {
		view.dispatch({ effects: setEditingEffect.of(id) });
	}

	async saveEdit(view: EditorView, id: string, instruction: string): Promise<void> {
		const text = instruction.trim();
		if (!text) return;
		try {
			await this.store.updateInstruction(id, text);
			view.dispatch({ effects: setEditingEffect.of(null) });
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not update annotation");
		}
	}

	async deleteAnnotation(id: string): Promise<void> {
		const index = this.store.annotations.findIndex((item) => item.id === id);
		try {
			const removed = await this.store.remove(id);
			if (!removed) return;
			showUndoNotice("Deleted annotation", () => {
				void this.store.restore(removed, index);
			});
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not delete annotation");
		}
	}

	async restoreMany(items: Annotation[]): Promise<void> {
		if (items.length === 0) return;
		const merged = [...this.store.annotations];
		for (const item of items) {
			if (!merged.some((existing) => existing.id === item.id)) merged.push(item);
		}
		await this.store.replaceAll(merged);
	}

	async revealFile(path: string): Promise<void> {
		const first = this.store.forFile(path)[0];
		if (first) {
			await this.revealAnnotation(first);
			return;
		}
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) await this.openInEditor(file);
		else new Notice(`File not found: ${path}`);
	}

	async revealAnnotation(annotation: Annotation): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(annotation.file);
		if (!(file instanceof TFile)) {
			new Notice(`File not found: ${annotation.file}`);
			return;
		}

		const leaf = await this.openInEditor(file);
		if (!this.settings.reviewMode) await this.setReviewMode(true);

		const view = leaf.view;
		if (!(view instanceof MarkdownView)) {
			new Notice("Could not open the file in the editor.");
			return;
		}
		const cm = getEditorView(view);
		if (!cm) {
			new Notice("Could not access the editor for this file.");
			return;
		}

		const loc = locateSelection(cm.state.doc.toString(), annotation);
		if (!loc) {
			new Notice("Could not locate the selected text in this file.");
			return;
		}

		const from = view.editor.offsetToPos(loc.from);
		const to = view.editor.offsetToPos(loc.to);
		view.editor.setSelection(from, to);
		view.editor.scrollIntoView({ from, to }, true);
		cm.dispatch({ effects: setFlashEffect.of(annotation.id) });
		window.setTimeout(() => {
			cm.dispatch({ effects: setFlashEffect.of(null) });
		}, FLASH_MS);
	}

	private async openInEditor(file: TFile) {
		const alreadyOpen = this.app.workspace.getLeavesOfType("markdown").find((item) => {
			return item.view instanceof MarkdownView && item.view.file?.path === file.path;
		});
		const active = this.app.workspace.activeEditor;
		const activeLeaf = active instanceof MarkdownView ? active.leaf : null;
		const leaf =
			alreadyOpen ??
			activeLeaf ??
			this.app.workspace.getLeavesOfType("markdown")[0] ??
			this.app.workspace.getLeaf("tab");
		await leaf.openFile(file, { active: true, eState: { focus: true } });
		await new Promise<void>((resolve) => {
			window.requestAnimationFrame(() => resolve());
		});
		return leaf;
	}

	async activateQueue(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_QUEUE)[0];
		if (existing) {
			this.app.workspace.revealLeaf(existing);
			return;
		}
		await this.app.workspace.ensureSideLeaf(VIEW_TYPE_QUEUE, "right", { reveal: true });
	}

	private async endSession(): Promise<void> {
		try {
			const items = await this.store.clearAll();
			showUndoNotice("Ended review session", () => {
				void this.restoreMany(items);
			});
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not end session");
		}
	}

	refreshEditors(): void {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (!(leaf.view instanceof MarkdownView)) continue;
			const cm = getEditorView(leaf.view);
			cm?.dispatch({ effects: refreshDecorationsEffect.of(null) });
		}
	}

	private refreshBadges(): void {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (!(leaf.view instanceof MarkdownView)) continue;
			const path = leaf.view.file?.path;
			updateFileBadge(leaf.view, path ? this.store.countForFile(path) : 0);
		}
	}

	private updateStatusBar(): void {
		if (!this.statusBarEl) return;
		const count = this.store.annotations.length;
		if (count === 0) {
			this.statusBarEl.setText("");
			this.statusBarEl.hide();
			return;
		}
		this.statusBarEl.show();
		this.statusBarEl.setText(`Agent annotations: ${count}`);
	}
}
