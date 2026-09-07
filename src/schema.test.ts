import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	emptyAnnotationFile,
	parseAnnotationFile,
	serializeAnnotationFile,
	writeBack,
} from "./schema";
import type { Annotation, AnnotationFile } from "./types";

function sample(id: string, extra?: Partial<Annotation>): Annotation {
	return {
		id,
		file: "docs/auth.md",
		instruction: `do ${id}`,
		selectedText: "Token expires.",
		headingPath: ["Auth"],
		prefix: "Hello ",
		suffix: " Bye",
		...extra,
	};
}

describe("parseAnnotationFile", () => {
	it("treats empty input as an empty queue", () => {
		assert.deepEqual(parseAnnotationFile(""), { ok: true, data: emptyAnnotationFile() });
	});

	it("rejects broken JSON without inventing a file", () => {
		const result = parseAnnotationFile("{not json");
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.error, /parse error/);
	});

	it("rejects unknown versions and missing required fields", () => {
		assert.equal(parseAnnotationFile('{"version":2,"annotations":[]}').ok, false);
		assert.equal(parseAnnotationFile('{"version":1,"annotations":[{"id":"a_1"}]}').ok, false);
	});

	it("keeps only protocol fields when serializing", () => {
		const raw = serializeAnnotationFile({
			version: 1,
			annotations: [
				{
					...sample("a_1"),
					status: "done",
				} as Annotation & { status: string },
			],
		});
		assert.equal(raw.includes("status"), false);
		assert.equal(parseAnnotationFile(raw).ok, true);
	});
});

describe("writeBack outcomes", () => {
	const original: AnnotationFile = {
		version: 1,
		annotations: [sample("a_ok"), sample("a_fail", { file: "docs/other.md" })],
	};

	it("empties the list when every id succeeds", () => {
		assert.deepEqual(writeBack(original, ["a_ok", "a_fail"]), emptyAnnotationFile());
	});

	it("keeps failed rows byte-identical in content", () => {
		const next = writeBack(original, ["a_ok"]);
		assert.deepEqual(next.annotations, [original.annotations[1]]);
	});

	it("leaves the file unchanged when nothing succeeded", () => {
		const next = writeBack(original, []);
		assert.deepEqual(next, original);
		assert.equal(serializeAnnotationFile(next), serializeAnnotationFile(original));
	});
});
