import type { EditorView } from "@codemirror/view";
import { Facet } from "@codemirror/state";
import type { AnnotationStore } from "./store";

export interface AnnotationHost {
	readonly store: AnnotationStore;
	isReviewMode(): boolean;
	setReviewMode(on: boolean): Promise<void>;
	beginDraft(view: EditorView, range?: { from: number; to: number }): void;
	cancelDraft(view: EditorView): void;
	saveDraft(view: EditorView, instruction: string): Promise<void>;
	setEditing(view: EditorView, id: string | null): void;
	saveEdit(view: EditorView, id: string, instruction: string): Promise<void>;
	deleteAnnotation(id: string): Promise<void>;
	filePathOf(view: EditorView): string | null;
	saveHotkey(): string;
	cancelHotkey(): string;
}

export const annotationHostFacet = Facet.define<AnnotationHost, AnnotationHost | null>({
	combine: (values) => values[0] ?? null,
});
