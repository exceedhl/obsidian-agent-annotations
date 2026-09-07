import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EditorState } from "@codemirror/state";
import { editorUiField, setDraftEffect } from "./editor/state";
import type { DraftAnnotation } from "./types";

function draft(from: number, to: number): DraftAnnotation {
	return {
		from,
		to,
		selectedText: "hello",
		headingPath: [],
		prefix: "",
		suffix: "",
	};
}

function stateWithDraft(doc: string, from: number, to: number): EditorState {
	const start = EditorState.create({ doc, extensions: [editorUiField] });
	return start.update({ effects: setDraftEffect.of(draft(from, to)) }).state;
}

describe("editorUiField draft mapping", () => {
	it("clears the draft when the selected span is deleted", () => {
		const after = stateWithDraft("hello world", 0, 5).update({
			changes: { from: 0, to: 5, insert: "" },
		}).state;
		assert.equal(after.field(editorUiField).draft, null);
	});

	it("keeps a mapped draft when text before it changes", () => {
		const after = stateWithDraft("hello world", 6, 11).update({
			changes: { from: 0, to: 0, insert: "oh " },
		}).state;
		const next = after.field(editorUiField).draft;
		assert.equal(next?.from, 9);
		assert.equal(next?.to, 14);
	});
});
