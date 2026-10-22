import { headingPathFromSource, headingPathsEqual } from "./headings";
import { hasRange, mapDocumentRange, type PosMap } from "./offsets";
import type { Annotation, AppliedChange, TextRange } from "./types";
import { CONTEXT_RADIUS } from "./types";

const APPLIED_ANCHOR_SPAN = 24;

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
	for (const item of annotations) {
		if (hasRange(item) && item.to > item.from) {
			if (item.from < to && from < item.to) return item;
			continue;
		}
		const loc = locateSelection(doc, item);
		if (loc && loc.from === from && loc.to === to) return item;
	}
	return null;
}

export function sameAnchor(a: Pick<Annotation, "file" | "from" | "to">, b: Pick<Annotation, "file" | "from" | "to">): boolean {
	if (a.file.replace(/\\/g, "/") !== b.file.replace(/\\/g, "/")) return false;
	if (!hasRange(a) || !hasRange(b) || a.to === a.from || b.to === b.from) return false;
	return a.from < b.to && b.from < a.to;
}

export function annotationRange(
	doc: string,
	item: Annotation,
	changes?: PosMap | null,
	before?: string,
): TextRange | null {
	if (hasRange(item)) {
		const mapped =
			changes && before !== undefined
				? mapDocumentRange(changes, before, doc, item.from, item.to)
				: clampToDoc(doc, item.from, item.to);
		if (mapped) return mapped;
	}
	return locateSelection(doc, item);
}

export function appliedRange(
	doc: string,
	change: AppliedChange,
	changes?: PosMap | null,
	before?: string,
): TextRange | null {
	if (hasRange(change)) {
		const mapped =
			changes && before !== undefined
				? mapDocumentRange(changes, before, doc, change.from, change.to)
				: clampToDoc(doc, change.from, change.to);
		if (mapped) return mapped;
	}
	return locateApplied(doc, change) ?? uniqueAnchoredSpan(doc, change.prefix, change.suffix);
}

/** The single gap between a recorded prefix and suffix, when both still occur once. */
export function uniqueAnchoredSpan(doc: string, prefix?: string, suffix?: string): TextRange | null {
	if (!prefix || !suffix) return null;
	const gaps: TextRange[] = [];
	let cursor = 0;
	while (cursor <= doc.length - prefix.length) {
		const index = doc.indexOf(prefix, cursor);
		if (index < 0) break;
		const from = index + prefix.length;
		const suffixAt = doc.indexOf(suffix, from);
		if (suffixAt >= 0) gaps.push({ from, to: suffixAt });
		cursor = index + 1;
	}
	if (gaps.length !== 1) return null;
	return gaps[0]!;
}

function clampToDoc(doc: string, from: number, to: number): TextRange | null {
	if (from < 0 || to > doc.length || to < from) return null;
	return { from, to };
}

export function locateApplied(doc: string, change: AppliedChange): TextRange | null {
	if (change.after) {
		return locateSelection(doc, {
			selectedText: change.after,
			headingPath: change.headingPath,
			prefix: change.prefix,
			suffix: change.suffix,
		});
	}
	const points = deletionPoints(doc, change);
	if (points.length === 0) return null;
	if (points.length === 1) {
		const at = points[0]!;
		return { from: at, to: at };
	}

	const item: Locatable = {
		selectedText: "",
		headingPath: change.headingPath,
		prefix: change.prefix,
		suffix: change.suffix,
	};
	const ranked = points
		.map((from) => ({ from, score: scoreCandidate(doc, from, 0, item) }))
		.sort((a, b) => b.score - a.score);
	const winner = ranked[0]!;
	const runnerUp = ranked[1];
	if (runnerUp && runnerUp.score === winner.score) return null;
	return { from: winner.from, to: winner.from };
}

export function visibleAppliedRange(doc: string, range: TextRange): TextRange {
	if (range.from !== range.to) return range;
	const forward = growForward(doc, range.to, APPLIED_ANCHOR_SPAN);
	if (forward > range.to) return { from: range.to, to: forward };
	const back = growBackward(doc, range.from, APPLIED_ANCHOR_SPAN);
	if (back < range.from) return { from: back, to: range.from };
	return range;
}

function deletionPoints(doc: string, change: AppliedChange): number[] {
	const prefix = change.prefix ?? "";
	const suffix = change.suffix ?? "";
	const points: number[] = [];
	if (prefix && suffix) {
		const needle = prefix + suffix;
		let cursor = 0;
		while (cursor <= doc.length - needle.length) {
			const index = doc.indexOf(needle, cursor);
			if (index < 0) break;
			points.push(index + prefix.length);
			cursor = index + 1;
		}
		return points;
	}
	if (prefix) {
		let cursor = 0;
		while (cursor <= doc.length - prefix.length) {
			const index = doc.indexOf(prefix, cursor);
			if (index < 0) break;
			points.push(index + prefix.length);
			cursor = index + 1;
		}
		return points;
	}
	if (suffix) {
		let cursor = 0;
		while (cursor <= doc.length - suffix.length) {
			const index = doc.indexOf(suffix, cursor);
			if (index < 0) break;
			points.push(index);
			cursor = index + 1;
		}
	}
	return points;
}

function growForward(doc: string, from: number, span: number): number {
	let to = Math.min(doc.length, from + span);
	const newline = doc.indexOf("\n", from);
	if (newline !== -1 && newline < to) to = newline;
	return to;
}

function growBackward(doc: string, to: number, span: number): number {
	let from = Math.max(0, to - span);
	const newline = doc.lastIndexOf("\n", to - 1);
	if (newline !== -1 && newline + 1 > from) from = newline + 1;
	return from;
}

/**
 * The text now sitting between an annotation's recorded prefix and suffix.
 * Returns null when those anchors are missing or no longer unique.
 */
export function anchoredReplacement(
	baseline: string,
	doc: string,
	item: Locatable,
): { before: string; after: string; at: number } | null {
	const prefix = item.prefix ?? "";
	const suffix = item.suffix ?? "";
	if (!prefix || !suffix || !item.selectedText) return null;
	const old = locateSelection(baseline, item);
	if (!old) return null;
	const before = baseline.slice(old.from, old.to);
	const gaps: TextRange[] = [];
	let cursor = 0;
	while (cursor <= doc.length - prefix.length) {
		const index = doc.indexOf(prefix, cursor);
		if (index < 0) break;
		const from = index + prefix.length;
		const suffixAt = doc.indexOf(suffix, from);
		if (suffixAt >= 0) gaps.push({ from, to: suffixAt });
		cursor = index + 1;
	}
	const gap = pickGap(doc, gaps, item);
	if (!gap) return null;
	const after = doc.slice(gap.from, gap.to);
	if (after === before) return null;
	return { before, after, at: gap.from };
}

function pickGap(doc: string, gaps: TextRange[], item: Locatable): TextRange | null {
	if (gaps.length === 0) return null;
	if (gaps.length === 1) return gaps[0]!;
	const ranked = gaps
		.map((gap) => ({ gap, score: scoreCandidate(doc, gap.from, 0, item) }))
		.sort((a, b) => b.score - a.score);
	const winner = ranked[0]!;
	const runnerUp = ranked[1];
	if (runnerUp && runnerUp.score === winner.score) return null;
	return winner.gap;
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
