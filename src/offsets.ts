import { ChangeSet } from "@codemirror/state";
import { positionEdits } from "./diff";
import type { TextRange } from "./types";

export interface PosMap {
	mapPos(pos: number, assoc?: number): number;
	iterChanges?(
		f: (fromA: number, toA: number, fromB: number, toB: number, inserted: { length: number }) => void,
		individual?: boolean,
	): void;
}

export function hasRange(span: { from: number; to: number }): boolean {
	return span.from >= 0 && span.to >= span.from;
}

export function readRange(value: { from?: unknown; to?: unknown }): { from: number; to: number } {
	if (
		typeof value.from === "number" &&
		typeof value.to === "number" &&
		Number.isInteger(value.from) &&
		Number.isInteger(value.to) &&
		value.from >= 0 &&
		value.to >= value.from
	) {
		return { from: value.from, to: value.to };
	}
	return { from: -1, to: -1 };
}

/** Keep a range on the same text. Insertions at the edges stay outside it. */
export function mapSpan(changes: PosMap, from: number, to: number): TextRange {
	const nextFrom = changes.mapPos(from, 1);
	let nextTo = changes.mapPos(to, -1);
	if (nextTo < nextFrom) nextTo = nextFrom;
	return { from: nextFrom, to: nextTo };
}

/**
 * Move a stored range through a document edit.
 * A single replacement of the whole note is mapped from the real diff, so untouched
 * ranges stay put and an edited range grows or shrinks with the new text.
 */
export function mapDocumentRange(changes: PosMap, before: string, after: string, from: number, to: number): TextRange {
	const mapped = replacesWholeDocument(changes, before.length)
		? mapAcross(before, after, from, to)
		: mapSpan(changes, from, to);
	return clampRange(after.length, mapped.from, mapped.to);
}

function mapAcross(before: string, after: string, from: number, to: number): TextRange {
	const edits = positionEdits(before, after);
	if (edits.length === 0) return { from, to };
	return mapSpan(ChangeSet.of(edits, before.length), from, to);
}

function replacesWholeDocument(changes: PosMap, oldLength: number): boolean {
	if (oldLength === 0 || !changes.iterChanges) return false;
	let count = 0;
	let whole = false;
	changes.iterChanges((from, to) => {
		count += 1;
		if (from === 0 && to === oldLength) whole = true;
	});
	return whole && count === 1;
}

function clampRange(docLength: number, from: number, to: number): TextRange {
	const start = Math.max(0, Math.min(from, docLength));
	const end = Math.max(start, Math.min(to, docLength));
	return { from: start, to: end };
}
