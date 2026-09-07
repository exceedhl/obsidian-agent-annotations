import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
	editorInfoField,
	MarkdownView,
	type Editor,
	type MarkdownFileInfo,
} from "obsidian";

export function getEditorView(view: MarkdownView): EditorView | null {
	return editorCm(view.editor);
}

export function editorCm(editor: Editor | undefined): EditorView | null {
	if (!editor) return null;
	return (editor as Editor & { cm?: EditorView }).cm ?? null;
}

export function resolveEditorView(
	editor: Editor,
	info?: MarkdownView | MarkdownFileInfo,
): EditorView | null {
	if (info instanceof MarkdownView) {
		return getEditorView(info) ?? editorCm(info.editor) ?? editorCm(editor);
	}
	return editorCm(info?.editor) ?? editorCm(editor);
}

export function selectionOffsets(editor: Editor): { from: number; to: number } | null {
	if (!editor.getSelection()) return null;
	const from = editor.posToOffset(editor.getCursor("from"));
	const to = editor.posToOffset(editor.getCursor("to"));
	if (from === to) return null;
	return { from: Math.min(from, to), to: Math.max(from, to) };
}

export function filePathFromState(state: EditorState): string | null {
	const info = state.field(editorInfoField, false);
	return info?.file?.path ?? null;
}

export function filePathFromView(view: EditorView): string | null {
	return filePathFromState(view.state);
}
