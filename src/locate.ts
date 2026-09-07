import { headingPathFromSource, headingPathsEqual } from "./headings";
import type { Annotation, TextRange } from "./types";
import { CONTEXT_RADIUS } from "./types";

export type Locatable = Pick<Annotation, "selectedText" | "headingPath" | "prefix" | "suffix">;

export function extractContext(
	doc: string,
	from: number,
	to: number,
	radius = CONTEXT_RADIUS,
): { prefix: string; suffix: string } {
	return {
		prefix: doc.slice(Math.max(0, from - radius), from),
		suffix: doc.slice(to, Math.min(doc.length, to + radius)),
	};
}

export function annotationAtRange(
	doc: string,
	annotations: Annotation[],
	from: number,
	to: number,
): Annotation | null {
	if (from >= to) return null;
	const selected = doc.slice(from, to);
	for (const item of annotations) {
		if (item.selectedText !== selected) continue;
		const loc = locateSelection(doc, item);
		if (loc && loc.from === from && loc.to === to) return item;
	}
	return null;
}

export function sameAnchor(
	a: Pick<Annotation, "file" | "selectedText" | "headingPath" | "prefix" | "suffix">,
	b: Pick<Annotation, "file" | "selectedText" | "headingPath" | "prefix" | "suffix">,
): boolean {
	if (a.file.replace(/\\/g, "/") !== b.file.replace(/\\/g, "/")) return false;
	if (a.selectedText !== b.selectedText) return false;
	const headingPath = a.headingPath ?? [];
	const prefix = a.prefix ?? "";
	const suffix = a.suffix ?? "";
	if (headingPath.length === 0 && !prefix && !suffix) return false;
	return (
		prefix === (b.prefix ?? "") &&
		suffix === (b.suffix ?? "") &&
		pathsEqual(headingPath, b.headingPath)
	);
}

function pathsEqual(a: string[] | undefined, b: string[] | undefined): boolean {
	const left = a ?? [];
	const right = b ?? [];
	return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function locateSelection(doc: string, item: Locatable): TextRange | null {
	const text = item.selectedText;
	if (!text) return null;

	const starts: number[] = [];
	let cursor = 0;
	while (cursor <= doc.length - text.length) {
		const index = doc.indexOf(text, cursor);
		if (index === -1) break;
		starts.push(index);
		cursor = index + 1;
	}

	if (starts.length === 0) return null;
	if (starts.length === 1) {
		const from = starts[0]!;
		return { from, to: from + text.length };
	}

	const ranked = starts
		.map((from) => ({ from, score: scoreCandidate(doc, from, text.length, item) }))
		.sort((a, b) => b.score - a.score);

	const winner = ranked[0]!;
	const runnerUp = ranked[1];
	if (runnerUp && runnerUp.score === winner.score) return null;
	return { from: winner.from, to: winner.from + text.length };
}

function scoreCandidate(
	doc: string,
	from: number,
	length: number,
	item: Locatable,
): number {
	let score = 0;
	const to = from + length;

	if (item.prefix) {
		const actual = doc.slice(Math.max(0, from - item.prefix.length), from);
		if (actual === item.prefix) score += 2;
		else if (overlapEnds(actual, item.prefix)) score += 1;
	}

	if (item.suffix) {
		const actual = doc.slice(to, to + item.suffix.length);
		if (actual === item.suffix) score += 2;
		else if (overlapStarts(actual, item.suffix)) score += 1;
	}

	if (item.headingPath?.length) {
		const path = headingPathFromSource(doc, from);
		if (headingPathsEqual(path, item.headingPath)) score += 3;
		else if (path[path.length - 1] === item.headingPath[item.headingPath.length - 1]) {
			score += 1;
		}
	}

	return score;
}

function overlapEnds(actual: string, expected: string): boolean {
	const slice = expected.slice(-Math.min(20, expected.length));
	return actual.endsWith(slice) || expected.endsWith(actual);
}

function overlapStarts(actual: string, expected: string): boolean {
	const slice = expected.slice(0, Math.min(20, expected.length));
	return actual.startsWith(slice) || expected.startsWith(actual);
}
