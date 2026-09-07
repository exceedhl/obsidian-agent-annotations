import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { headingPathFromSource } from "./headings";
import { annotationAtRange, extractContext, locateSelection, sameAnchor } from "./locate";

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
			[{ id: "a", file: "note.md", instruction: "x", selectedText: "前文" }],
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
			[{ id: "a", file: "note.md", instruction: "x", selectedText: "后文" }],
			from,
			from + 2,
		);
		assert.equal(hit, null);
	});
});

describe("sameAnchor", () => {
	it("does not treat bare selectedText as the same occurrence", () => {
		assert.equal(
			sameAnchor(
				{ file: "a.md", selectedText: "x" },
				{ file: "a.md", selectedText: "x", headingPath: [], prefix: "", suffix: "" },
			),
			false,
		);
	});

	it("matches when file, text, and context are the same", () => {
		assert.equal(
			sameAnchor(
				{ file: "a.md", selectedText: "x", headingPath: ["H"], prefix: "p", suffix: "s" },
				{ file: "a.md", selectedText: "x", headingPath: ["H"], prefix: "p", suffix: "s" },
			),
			true,
		);
	});

	it("distinguishes a different prefix", () => {
		assert.equal(
			sameAnchor(
				{ file: "a.md", selectedText: "x", prefix: "one" },
				{ file: "a.md", selectedText: "x", prefix: "two" },
			),
			false,
		);
	});
});
