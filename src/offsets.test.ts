import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChangeSet } from "@codemirror/state";
import { mapDocumentRange, mapSpan } from "./offsets";

describe("mapSpan", () => {
	it("shifts when text is inserted before the span", () => {
		const changes = ChangeSet.of([{ from: 0, to: 0, insert: "oh " }], "hello world".length);
		assert.deepEqual(mapSpan(changes, 6, 11), { from: 9, to: 14 });
	});

	it("follows a replacement of the span itself", () => {
		const changes = ChangeSet.of([{ from: 6, to: 11, insert: "there" }], "hello world".length);
		assert.deepEqual(mapSpan(changes, 6, 11), { from: 6, to: 11 });
		const wider = ChangeSet.of([{ from: 6, to: 11, insert: "people" }], "hello world".length);
		assert.deepEqual(mapSpan(wider, 6, 11), { from: 6, to: 12 });
	});

	it("collapses when the span is deleted", () => {
		const changes = ChangeSet.of([{ from: 5, to: 11, insert: "" }], "hello world".length);
		assert.deepEqual(mapSpan(changes, 6, 11), { from: 5, to: 5 });
	});
});

describe("mapDocumentRange", () => {
	it("keeps a range when the whole note is replaced but only the middle changed", () => {
		const before = "hello world\nTAIL";
		const after = "hello people\nTAIL";
		const changes = ChangeSet.of([{ from: 0, to: before.length, insert: after }], before.length);
		assert.deepEqual(mapDocumentRange(changes, before, after, 6, 11), { from: 6, to: 12 });
		assert.deepEqual(mapDocumentRange(changes, before, after, 12, 16), { from: 13, to: 17 });
	});

	it("uses the transaction when the edit is local", () => {
		const before = "hello world";
		const changes = ChangeSet.of([{ from: 0, to: 0, insert: "oh " }], before.length);
		assert.deepEqual(mapDocumentRange(changes, before, "oh hello world", 6, 11), { from: 9, to: 14 });
	});
});
