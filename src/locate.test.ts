import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { headingPathFromSource } from "./headings";
import { annotationAtRange, extractContext, locateApplied, locateSelection, sameAnchor, visibleAppliedRange } from "./locate";
import type { AppliedChange } from "./types";

const doc = [
	"# 认证",
	"",
	"## 令牌生命周期",
	"",
	"前文 Token 会在 24 小时后过期。 后文",
	"",
	"## 其它",
	"",
	"Token 会在 24 小时后过期。",
	"",
].join("\n");

describe("headingPathFromSource", () => {
	it("builds the heading stack at the first occurrence", () => {
		const pos = doc.indexOf("前文");
		assert.deepEqual(headingPathFromSource(doc, pos), ["认证", "令牌生命周期"]);
	});
});

describe("extractContext", () => {
	it("takes about 40 characters on each side", () => {
		const from = doc.indexOf("前文");
		const to = from + 2;
		const ctx = extractContext(doc, from, to, 4);
		assert.equal(ctx.prefix.length <= 4, true);
		assert.equal(ctx.suffix.length <= 4, true);
	});
});

describe("locateSelection", () => {
	it("returns the only match without extra hints", () => {
		const hit = locateSelection(doc, { selectedText: "前文" });
		assert.deepEqual(hit, { from: doc.indexOf("前文"), to: doc.indexOf("前文") + 2 });
	});

	it("uses headingPath and prefix to pick among duplicates", () => {
		const text = "Token 会在 24 小时后过期。";
		const first = doc.indexOf(text);
		const second = doc.indexOf(text, first + 1);
		const hit = locateSelection(doc, {
			selectedText: text,
			headingPath: ["认证", "令牌生命周期"],
			prefix: "前文 ",
			suffix: " 后文",
		});
		assert.equal(hit?.from, first);
		assert.notEqual(hit?.from, second);
	});

	it("returns null when the selected text is gone", () => {
		assert.equal(locateSelection(doc, { selectedText: "does-not-exist" }), null);
	});

	it("returns null when two matches score the same", () => {
		assert.equal(locateSelection(doc, { selectedText: "Token 会在 24 小时后过期。" }), null);
	});
});

describe("annotationAtRange", () => {
	it("finds an annotation on the same span", () => {
		const from = doc.indexOf("前文");
		const to = from + 2;
		const hit = annotationAtRange(
			doc,
			[{ id: "a", file: "note.md", instruction: "x", selectedText: "前文", from: -1, to: -1 }],
			from,
			to,
		);
		assert.equal(hit?.id, "a");
	});

	it("ignores a different occurrence of the same text", () => {
		const text = "Token 会在 24 小时后过期。";
		const first = doc.indexOf(text);
		const second = doc.indexOf(text, first + 1);
		const hit = annotationAtRange(
			doc,
			[
				{
					id: "a",
					file: "note.md",
					instruction: "x",
					selectedText: text,
					headingPath: ["认证", "令牌生命周期"],
					prefix: "前文 ",
					suffix: " 后文",
					from: -1,
					to: -1,
				},
			],
			second,
			second + text.length,
		);
		assert.equal(hit, null);
	});

	it("skips annotations whose selectedText is not this span", () => {
		const from = doc.indexOf("前文");
		const hit = annotationAtRange(
			doc,
			[{ id: "a", file: "note.md", instruction: "x", selectedText: "后文", from: -1, to: -1 }],
			from,
			from + 2,
		);
		assert.equal(hit, null);
	});
});

describe("locateApplied", () => {
	it("finds a replacement and a deletion point", () => {
		const updated = doc.replace("前文 Token 会在 24 小时后过期。", "前文 Token 会在 12 小时后过期。");
		const from = updated.indexOf("12");
		const replacement: AppliedChange = {
			id: "c_1",
			file: "docs/auth.md",
			before: "24",
			after: "12",
			headingPath: ["认证", "令牌生命周期"],
			from: -1,
			to: -1,
			...extractContext(updated, from, from + 2),
		};
		assert.deepEqual(locateApplied(updated, replacement), { from, to: from + 2 });

		const deleted = doc.replace("前文 Token 会在 24 小时后过期。 后文", "前文 后文");
		const at = deleted.indexOf("后文");
		const removal: AppliedChange = {
			id: "c_2",
			file: "docs/auth.md",
			before: "Token 会在 24 小时后过期。 ",
			after: "",
			from: -1,
			to: -1,
			...extractContext(deleted, at, at),
		};
		const point = locateApplied(deleted, removal);
		assert.ok(point);
		assert.equal(point.from, at);
		const visible = visibleAppliedRange(deleted, point);
		assert.equal(deleted.slice(visible.from, visible.to).startsWith("后文"), true);
	});
});

describe("sameAnchor", () => {
	it("does not treat two unplaced rows as the same occurrence", () => {
		assert.equal(
			sameAnchor({ file: "a.md", from: -1, to: -1 }, { file: "a.md", from: -1, to: -1 }),
			false,
		);
	});

	it("matches when the ranges overlap in the same file", () => {
		assert.equal(sameAnchor({ file: "a.md", from: 1, to: 4 }, { file: "a.md", from: 3, to: 8 }), true);
	});

	it("distinguishes ranges that do not overlap", () => {
		assert.equal(sameAnchor({ file: "a.md", from: 1, to: 4 }, { file: "a.md", from: 4, to: 8 }), false);
	});
});
