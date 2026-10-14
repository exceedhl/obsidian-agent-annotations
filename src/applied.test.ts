import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppliedStore, type AppliedIO } from "./applied-store";
import { parseAppliedFile, serializeAppliedFile } from "./applied-schema";
import type { StoreSnapshot } from "./store";
import type { Annotation, AppliedChange } from "./types";

const file = "docs/auth.md";

function annotation(id: string, path = file): Annotation {
	return {
		id,
		file: path,
		instruction: `do ${id}`,
		selectedText: "soon",
		headingPath: ["Auth"],
	};
}

function snapshot(annotations: Annotation[], status: StoreSnapshot["status"] = "ok"): StoreSnapshot {
	return {
		status,
		file: { version: 1, annotations },
		error: status === "error" ? "broken" : null,
		exists: true,
	};
}

function memory(initial: Record<string, string>, applied = "") {
	const notes = new Map(Object.entries(initial));
	let saved = applied;
	let baselines = "";
	let slept = false;
	const io: AppliedIO = {
		readApplied: async () => (saved.trim() ? saved : null),
		writeApplied: async (content) => {
			saved = content;
		},
		readNote: async (path) => notes.get(path) ?? null,
		readBaselines: async () => (baselines.trim() ? baselines : null),
		writeBaselines: async (content) => {
			baselines = content;
		},
	};
	return {
		notes,
		io,
		saved: () => saved,
		slept: () => slept,
		sleep: async () => {
			slept = true;
		},
	};
}

async function open(env: ReturnType<typeof memory>, annotations: Annotation[]) {
	const store = new AppliedStore(env.io, env.sleep);
	await store.load(annotations);
	return store;
}

describe("applied.json", () => {
	it("round-trips changed text and drops unknown fields", () => {
		const change: AppliedChange = {
			id: "c_1",
			file,
			before: "soon",
			after: "later",
			headingPath: ["Auth"],
			prefix: "Token expires ",
			suffix: ".",
		};
		const raw = serializeAppliedFile({
			version: 1,
			changes: [{ ...change, status: "done" } as AppliedChange & { status: string }],
		});
		assert.equal(raw.includes("status"), false);
		const parsed = parseAppliedFile(raw);
		assert.equal(parsed.ok, true);
		if (parsed.ok) assert.deepEqual(parsed.data.changes, [change]);
		assert.equal(parseAppliedFile("{").ok, false);
	});
});

describe("AppliedStore", () => {
	it("stores only the edited words and replaces them on the next real run", async () => {
		const unchanged = "unchanged paragraph. ".repeat(20);
		const original = `# Auth\n\n${unchanged}Token expires soon.\n`;
		const edited = `# Auth\n\n${unchanged}Token expires later.\n`;
		const env = memory({ [file]: original });
		const store = await open(env, [annotation("a_1")]);

		env.notes.set(file, edited);
		store.syncQueue(snapshot([]));
		await store.whenIdle();

		assert.equal(env.slept(), false);
		assert.equal(store.changes.length, 1);
		assert.equal(store.changes[0]?.before, "soon");
		assert.equal(store.changes[0]?.after, "later");
		assert.equal(store.changes[0]?.id.startsWith("c_"), true);
		assert.equal(env.saved().includes(unchanged.trim()), false);
		const firstIds = store.changes.map((item) => item.id);

		const other = "notes/api.md";
		env.notes.set(other, "Keep this.\n");
		store.seedBaseline(other, "Keep this.\n");
		store.syncQueue(snapshot([annotation("b_1", other)]));
		await store.whenIdle();
		assert.deepEqual(store.changes.map((item) => item.id), firstIds);

		env.notes.set(other, "Drop this.\n");
		store.syncQueue(snapshot([]));
		await store.whenIdle();
		assert.equal(store.changes.length, 1);
		assert.equal(store.changes[0]?.file, other);
		assert.equal(store.changes[0]?.before, "Keep");
		assert.equal(store.changes[0]?.after, "Drop");
		assert.equal(store.changes.some((item) => item.file === file), false);
	});

	it("keeps the previous changes when the queue shrinks without a text edit", async () => {
		const text = "# Auth\n\nToken expires soon.\n";
		const env = memory({ [file]: text });
		const store = await open(env, [annotation("a_1"), annotation("a_2")]);
		env.notes.set(file, "# Auth\n\nToken expires later.\n");
		store.syncQueue(snapshot([annotation("a_2")]));
		await store.whenIdle();
		const ids = store.changes.map((item) => item.id);
		assert.equal(ids.length, 1);

		store.syncQueue(snapshot([]));
		await store.whenIdle();
		assert.equal(env.slept(), true);
		assert.deepEqual(store.changes.map((item) => item.id), ids);
	});

	it("diffs from the latest human edit and ignores a broken queue", async () => {
		const original = "# Auth\n\nToken expires soon.\n";
		const env = memory({ [file]: original });
		const store = await open(env, [annotation("a_1")]);
		store.noteUserEdit(file, "# Auth\n\nToken expires tonight.\n");
		env.notes.set(file, "# Auth\n\nToken expires tomorrow.\n");

		store.syncQueue(snapshot([], "error"));
		await store.whenIdle();
		assert.equal(store.changes.length, 0);

		store.syncQueue(snapshot([]));
		await store.whenIdle();
		assert.equal(store.changes[0]?.before, "tonight");
		assert.equal(store.changes[0]?.after, "tomorrow");
	});

	it("keeps the pre-edit text when Obsidian reloads after the note was already changed", async () => {
		const original = "# Auth\n\nToken expires soon.\n";
		const edited = "# Auth\n\nToken expires later.\n";
		const env = memory({ [file]: original });
		await open(env, [annotation("a_1")]);
		env.notes.set(file, edited);
		const reloaded = await open(env, [annotation("a_1")]);
		reloaded.syncQueue(snapshot([]));
		await reloaded.whenIdle();
		assert.equal(reloaded.changes[0]?.before, "soon");
		assert.equal(reloaded.changes[0]?.after, "later");
	});

	it("joins a rewrite that was stored as several pieces", async () => {
		const path = "00_Inbox/scratchpad.md";
		const poem = "窗先暗下来。\n灯留一角，桌子空着。\n笔停在半句上。\n门外脚步过去，没有敲门。";
		const doc = `# 2026-10-14 16:48\n\n${poem}`;
		const pieces: AppliedChange[] = [
			{ id: "c_1", file: path, before: "另外", after: "窗先暗下来。\n灯留" },
			{ id: "c_2", file: path, before: "个诗", after: "角，桌子空着。\n笔停在半" },
			{ id: "c_3", file: path, before: "", after: "上。\n门外脚步过去，没有敲门。" },
		];
		const env = memory({ [path]: doc }, serializeAppliedFile({ version: 1, changes: pieces }));
		const store = await open(env, []);
		assert.equal(store.changes.length, 1);
		assert.equal(store.changes[0]?.id, "c_1");
		assert.equal(store.changes[0]?.before, "另外一个诗句");
		assert.equal(store.changes[0]?.after, poem);
		assert.equal(env.saved().includes("c_2"), false);
	});

	it("keeps a change that is recorded after clear is requested", async () => {
		const original = "# Auth\n\nToken expires soon.\n";
		const edited = "# Auth\n\nToken expires later.\n";
		const env = memory({ [file]: original });
		const store = await open(env, [annotation("a_1")]);
		env.notes.set(file, edited);
		store.syncQueue(snapshot([]));
		const removed = await store.clear();
		await store.whenIdle();
		assert.deepEqual(removed, []);
		assert.equal(store.changes.length, 1);
		assert.equal(store.changes[0]?.after, "later");
	});

	it("clears applied changes and restores them", async () => {
		const original = "# Auth\n\nToken expires soon.\n";
		const edited = "# Auth\n\nToken expires later.\n";
		const env = memory({ [file]: original });
		const store = await open(env, [annotation("a_1")]);
		env.notes.set(file, edited);
		store.syncQueue(snapshot([]));
		await store.whenIdle();
		assert.equal(store.changes.length, 1);

		const removed = await store.clear();
		assert.equal(store.changes.length, 0);
		assert.equal(removed[0]?.before, "soon");
		assert.equal(env.saved().includes('"changes": []'), true);

		await store.restore(removed);
		assert.equal(store.changes.length, 1);
		assert.equal(store.changes[0]?.after, "later");
	});

	it("reads the note again when the queue moves before the file does", async () => {
		const original = "# Auth\n\nToken expires soon.\n";
		const edited = "# Auth\n\nToken expires later.\n";
		let fresh = false;
		const env = memory({ [file]: original });
		env.io.readNote = async () => (fresh ? edited : original);
		const store = new AppliedStore(env.io, async () => {
			fresh = true;
		});
		await store.load([annotation("a_1")]);
		store.syncQueue(snapshot([]));
		await store.whenIdle();
		assert.equal(store.changes[0]?.before, "soon");
		assert.equal(store.changes[0]?.after, "later");
	});
});
