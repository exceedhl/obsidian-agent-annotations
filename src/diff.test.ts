import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffHunks } from "./diff";

describe("diffHunks", () => {
	it("keeps a few changed characters", () => {
		const hunks = diffHunks("令牌会在24小时后过期。", "令牌会在12小时后过期。");
		assert.equal(hunks.length, 1);
		assert.equal(hunks[0]?.before, "24");
		assert.equal(hunks[0]?.after, "12");
	});

	it("records an inserted sentence and a deletion", () => {
		const inserted = diffHunks("第一句。\n", "第一句。\n第二句。\n");
		assert.equal(inserted.length, 1);
		assert.equal(inserted[0]?.before, "");
		assert.match(inserted[0]?.after ?? "", /第二句/);

		const removed = diffHunks("保留。\n删掉。\n", "保留。\n");
		assert.equal(removed.length, 1);
		assert.match(removed[0]?.before ?? "", /删掉/);
		assert.equal(removed[0]?.after, "");
	});

	it("keeps every edit in one span", () => {
		const before = "aaa XXX ccc YYY eee";
		const after = "aaa xxx ccc yyy eee";
		const hunks = diffHunks(before, after);
		assert.equal(hunks.length, 1);
		assert.equal(hunks[0]?.before, "XXX ccc YYY");
		assert.equal(hunks[0]?.after, "xxx ccc yyy");
		assert.equal(after.slice(hunks[0]!.at, hunks[0]!.at + hunks[0]!.after.length), hunks[0]?.after);
	});

	it("keeps one rewrite when the two sides only share a character", () => {
		const before = "另外一个诗句";
		const after = "窗先暗下来。\n灯留一角，桌子空着。\n笔停在半句上。\n门外脚步过去，没有敲门。";
		const hunks = diffHunks(before, after);
		assert.equal(hunks.length, 1);
		assert.equal(hunks[0]?.before, before);
		assert.equal(hunks[0]?.after, after);
	});

	it("keeps a multiline rewrite as one span", () => {
		const hunks = diffHunks("AAA\nBBB\n", "aaa\nbbb\n");
		assert.equal(hunks.length, 1);
		assert.equal(hunks[0]?.before, "AAA\nBBB");
		assert.equal(hunks[0]?.after, "aaa\nbbb");
	});

	it("ignores a trailing newline and keeps a blank line inside one rewrite", () => {
		assert.deepEqual(diffHunks("foo\n", "foo"), []);
		const hunks = diffHunks("Alpha\n\nBeta\n", "Delta\n\nGamma\n");
		assert.equal(hunks.length, 1);
		assert.equal(hunks[0]?.before, "Alpha\n\nBeta");
		assert.equal(hunks[0]?.after, "Delta\n\nGamma");
	});

	it("splits edits that keep a paragraph between them", () => {
		const mid = "这段不动。\n";
		const before = `Alpha\n\n${mid}\nBeta\n`;
		const after = `Delta\n\n${mid}\nGamma\n`;
		const hunks = diffHunks(before, after);
		assert.equal(hunks.length, 2);
		assert.equal(hunks[0]?.before, "Alpha");
		assert.equal(hunks[0]?.after, "Delta");
		assert.equal(hunks[1]?.before, "Beta");
		assert.equal(hunks[1]?.after, "Gamma");
		assert.equal(after.slice(hunks[0]!.at, hunks[0]!.at + hunks[0]!.after.length), hunks[0]?.after);
		assert.equal(after.slice(hunks[1]!.at, hunks[1]!.at + hunks[1]!.after.length), hunks[1]?.after);
	});
});
