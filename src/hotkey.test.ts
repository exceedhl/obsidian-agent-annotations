import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatChord, matchesChord, parseChord } from "./hotkey";

function key(
	init: Pick<KeyboardEvent, "key"> & Partial<Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">>,
): KeyboardEvent {
	return {
		key: init.key,
		metaKey: init.metaKey ?? false,
		ctrlKey: init.ctrlKey ?? false,
		altKey: init.altKey ?? false,
		shiftKey: init.shiftKey ?? false,
	} as KeyboardEvent;
}

describe("parseChord", () => {
	it("reads Mod+Enter", () => {
		assert.deepEqual(parseChord("Mod+Enter"), {
			mod: true,
			ctrl: false,
			meta: false,
			alt: false,
			shift: false,
			key: "Enter",
		});
	});
});

describe("matchesChord", () => {
	it("treats Mod as ⌘ on Mac and Ctrl elsewhere", () => {
		assert.equal(matchesChord(key({ key: "Enter", metaKey: true }), "Mod+Enter", true), true);
		assert.equal(matchesChord(key({ key: "Enter", ctrlKey: true }), "Mod+Enter", false), true);
		assert.equal(matchesChord(key({ key: "Enter", ctrlKey: true }), "Mod+Enter", true), false);
	});

	it("matches Escape without modifiers", () => {
		assert.equal(matchesChord(key({ key: "Escape" }), "Escape", true), true);
		assert.equal(matchesChord(key({ key: "Escape", metaKey: true }), "Escape", true), false);
	});
});

describe("formatChord", () => {
	it("prints compact glyphs on Mac", () => {
		assert.equal(formatChord("Mod+Enter", true), "⌘↵");
		assert.equal(formatChord("Escape", true), "Esc");
	});
});
