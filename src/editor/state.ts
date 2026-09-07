import { StateEffect, StateField } from "@codemirror/state";
import type { DraftAnnotation, EditorUiState } from "../types";

export const setDraftEffect = StateEffect.define<DraftAnnotation | null>();
export const setEditingEffect = StateEffect.define<string | null>();
export const setFlashEffect = StateEffect.define<string | null>();
export const refreshDecorationsEffect = StateEffect.define<null>();

const emptyUi: EditorUiState = {
	draft: null,
	editingId: null,
	flashId: null,
};

export const editorUiField = StateField.define<EditorUiState>({
	create: () => emptyUi,
	update(value, tr) {
		let next = value;
		for (const effect of tr.effects) {
			if (effect.is(setDraftEffect)) {
				next = { ...next, draft: effect.value, editingId: null };
			} else if (effect.is(setEditingEffect)) {
				next = { ...next, editingId: effect.value };
			} else if (effect.is(setFlashEffect)) {
				next = { ...next, flashId: effect.value };
			}
		}
		if (tr.docChanged && next.draft) {
			const from = tr.changes.mapPos(next.draft.from, 1);
			const to = tr.changes.mapPos(next.draft.to, -1);
			next =
				from >= to
					? { ...next, draft: null }
					: { ...next, draft: { ...next.draft, from, to } };
		}
		return next;
	},
});
