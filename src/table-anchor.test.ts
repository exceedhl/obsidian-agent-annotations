import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Text } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import { cardWidgetAnchor } from "./editor/table-anchor";

class ProbeWidget extends WidgetType {
	toDOM(): HTMLElement {
		return document.createElement("div");
	}
}

function docOf(lines: string[]): Text {
	return Text.of(lines);
}

function anchorAt(lines: string[], lineNumber: number) {
	const doc = docOf(lines);
	return cardWidgetAnchor(doc, doc.line(lineNumber).to);
}

describe("cardWidgetAnchor", () => {
	const table = ["| 问题 | 说明 |", "| --- | --- |", "| 影子使用 | 员工转向个人账号 |", "", "后文"];

	it("leaves a prose line on the line end", () => {
		const doc = docOf(["普通段落"]);
		const anchor = cardWidgetAnchor(doc, doc.line(1).to);
		assert.deepEqual(anchor, { pos: doc.line(1).to, inlineOrder: false });
	});

	it("leaves a middle table row on the line end", () => {
		const anchor = anchorAt(table, 1);
		const doc = docOf(table);
		assert.deepEqual(anchor, { pos: doc.line(1).to, inlineOrder: false });
	});

	it("keeps the last row inside the table replace when more text follows", () => {
		const doc = docOf(table);
		const anchor = anchorAt(table, 3);
		assert.deepEqual(anchor, { pos: doc.line(3).to, inlineOrder: true });
	});

	it("keeps a trailing newline from counting as the end of the document", () => {
		const lines = ["| a | b |", "| --- | --- |", "| c | d |", ""];
		const doc = docOf(lines);
		const anchor = anchorAt(lines, 3);
		assert.deepEqual(anchor, { pos: doc.line(3).to, inlineOrder: true });
	});

	it("steps back one character when the table is the end of the document", () => {
		const lines = ["| a | b |", "| --- | --- |", "| c | d |"];
		const doc = docOf(lines);
		const anchor = anchorAt(lines, 3);
		assert.deepEqual(anchor, { pos: doc.line(3).to - 1, inlineOrder: false });
	});

	it("does not treat a pipe line without a separator as a table", () => {
		const lines = ["| not a table |"];
		const doc = docOf(lines);
		assert.deepEqual(anchorAt(lines, 1), { pos: doc.line(1).to, inlineOrder: false });
	});

	it("anchors the last row of a simple table", () => {
		const lines = ["问题 | 说明", "--- | ---", "影子使用 | 跟不上", "", "后文"];
		const doc = docOf(lines);
		assert.deepEqual(anchorAt(lines, 3), { pos: doc.line(3).to, inlineOrder: true });
		assert.deepEqual(anchorAt(lines, 1), { pos: doc.line(1).to, inlineOrder: false });
	});

	it("stops at the first table when another table follows", () => {
		const lines = [
			"| a | b |",
			"| --- | --- |",
			"| last | row |",
			"",
			"| c | d |",
			"| --- | --- |",
			"| e | f |",
		];
		const doc = docOf(lines);
		assert.deepEqual(anchorAt(lines, 3), { pos: doc.line(3).to, inlineOrder: true });
		assert.deepEqual(anchorAt(lines, 7), { pos: doc.line(7).to - 1, inlineOrder: false });
	});
});

describe("block widget side against a table replace", () => {
	it("sorts an inlineOrder block widget inside an inclusive table replace", () => {
		const widget = new ProbeWidget();
		const outside = Decoration.widget({ widget, block: true, side: 1 });
		const inside = Decoration.widget({ widget, block: true, side: 1, inlineOrder: true });
		const tableEndSide = 200_000_001;
		assert.ok(sideOf(outside) > tableEndSide);
		assert.ok(sideOf(inside) < tableEndSide);
		assert.ok(sideOf(inside) > 0);
	});
});

function sideOf(deco: Decoration): number {
	return (deco as Decoration & { startSide: number }).startSide;
}
