import { Text } from "@codemirror/state";

/**
 * Where a block card for one line should sit.
 *
 * Obsidian live preview replaces a pipe table with one block widget.
 * That range ends on the last row's `line.to`. A block card placed on
 * the same position uses side ≈ 3e8, which sorts after the replace
 * (end side ≈ 2e8) and is drawn a second time under the table. The
 * cell editor still draws the card inside the cell.
 *
 * `inlineOrder` drops the side to ≈ 1e8 so the card stays inside the
 * replace. When the table is the last line of the document the replace
 * is non-inclusive (end side ≈ -6e8); no widget side falls inside that,
 * so the anchor moves one character earlier instead.
 */
export interface CardWidgetAnchor {
	pos: number;
	inlineOrder: boolean;
}

const NORMAL_ROW = /^\|(?:[^|]+\|)+?\s*$/;
const SIMPLE_ROW = /^\s*[^|\s].*?\|.*[^|\s]\s*$/;
const NORMAL_CONT = /^\|/;
const SIMPLE_CONT = /^\s*[^|].*\|/;
const SEP_CELL = /^\s*:?\s*-+\s*:?\s*$/;

type TableKind = "normal" | "simple";

export function cardWidgetAnchor(doc: Text, lineEnd: number): CardWidgetAnchor {
	const line = doc.lineAt(lineEnd);
	if (tableEndLine(doc, line.number) !== line.number) {
		return { pos: line.to, inlineOrder: false };
	}
	if (line.to === doc.length && line.to > line.from) {
		return { pos: line.to - 1, inlineOrder: false };
	}
	return { pos: line.to, inlineOrder: true };
}

function tableEndLine(doc: Text, lineNumber: number): number | null {
	let start = lineNumber;
	while (start > 1) {
		const prev = doc.line(start - 1).text;
		if (!prev.trim()) break;
		if (!continues(prev, "normal") && !continues(prev, "simple") && !isSeparatorLine(prev)) break;
		start--;
	}

	let header = -1;
	let kind: TableKind = "normal";
	for (let i = start; i < doc.lines; i++) {
		const rowKind = headerKind(doc.line(i).text);
		const next = doc.line(i + 1).text;
		if (rowKind && isSeparatorLine(next)) {
			if (i > lineNumber) break;
			header = i;
			kind = rowKind;
			break;
		}
		if (i >= lineNumber) break;
	}
	if (header < 0 || lineNumber < header) return null;

	let end = header + 1;
	for (let i = end + 1; i <= doc.lines; i++) {
		if (!continues(doc.line(i).text, kind)) break;
		end = i;
	}
	return lineNumber <= end ? end : null;
}

function headerKind(text: string): TableKind | null {
	if (NORMAL_ROW.test(text)) return "normal";
	if (SIMPLE_ROW.test(text)) return "simple";
	return null;
}

function continues(text: string, kind: TableKind): boolean {
	return kind === "normal" ? NORMAL_CONT.test(text) : SIMPLE_CONT.test(text);
}

function isSeparatorLine(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed.includes("|")) return false;
	let inner = trimmed;
	if (inner.startsWith("|")) inner = inner.slice(1);
	if (inner.endsWith("|")) inner = inner.slice(0, -1);
	const cells = inner.split("|");
	return cells.length > 0 && cells.every((cell) => SEP_CELL.test(cell));
}
