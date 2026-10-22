export interface TextHunk {
	before: string;
	after: string;
	/** Index of `after` in the new document. A deletion is a caret at `at`. */
	at: number;
}

const TOKEN = /[A-Za-z0-9_]+|\s+|[^\sA-Za-z0-9_]/gu;

interface Piece {
	before: string;
	after: string;
	at: number;
	/** Unchanged text between this piece and the previous one. */
	gapBefore: string;
}

/**
 * Separate edits stay separate. A blank line between them does not.
 * Characters that match inside one replacement are not extra entries.
 */
export function diffHunks(before: string, after: string): TextHunk[] {
	if (before === after) return [];
	const pieces = piecesFromEdits(lineEdits(splitLines(before), splitLines(after)));
	return mergeBlankGaps(pieces)
		.map(trimHunk)
		.filter((hunk) => hunk.before.trim() !== hunk.after.trim());
}

function splitLines(text: string): string[] {
	if (!text) return [];
	const lines: string[] = [];
	let start = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] !== "\n") continue;
		lines.push(text.slice(start, i + 1));
		start = i + 1;
	}
	if (start < text.length) lines.push(text.slice(start));
	return lines;
}

function piecesFromEdits(edits: LineEdit[]): Piece[] {
	const pieces: Piece[] = [];
	let pos = 0;
	let gap = "";
	let before = "";
	let after = "";
	let at = -1;
	const flush = () => {
		if (!before && !after) return;
		pieces.push({ before, after, at, gapBefore: gap });
		before = "";
		after = "";
		at = -1;
		gap = "";
	};
	for (const edit of edits) {
		if (edit.op === "equal") {
			if (before || after) flush();
			gap += edit.text;
			pos += edit.text.length;
			continue;
		}
		if (at < 0) at = pos;
		if (edit.op === "delete") {
			before += edit.text;
			continue;
		}
		after += edit.text;
		pos += edit.text.length;
	}
	flush();
	return pieces;
}

function mergeBlankGaps(pieces: Piece[]): TextHunk[] {
	const merged: TextHunk[] = [];
	for (const piece of pieces) {
		const prev = merged[merged.length - 1];
		if (prev && piece.gapBefore.trim() === "") {
			prev.before += piece.gapBefore + piece.before;
			prev.after += piece.gapBefore + piece.after;
			continue;
		}
		merged.push({ before: piece.before, after: piece.after, at: piece.at });
	}
	return merged;
}

function trimHunk(hunk: TextHunk): TextHunk {
	const left = tokenize(hunk.before);
	const right = tokenize(hunk.after);
	let prefix = 0;
	const limit = Math.min(left.length, right.length);
	while (prefix < limit && left[prefix] === right[prefix]) prefix += 1;

	let leftEnd = left.length;
	let rightEnd = right.length;
	while (leftEnd > prefix && rightEnd > prefix && left[leftEnd - 1] === right[rightEnd - 1]) {
		leftEnd -= 1;
		rightEnd -= 1;
	}

	const skipped = right.slice(0, prefix).join("").length;
	return {
		before: left.slice(prefix, leftEnd).join(""),
		after: right.slice(prefix, rightEnd).join(""),
		at: hunk.at + skipped,
	};
}

function tokenize(text: string): string[] {
	if (!text) return [];
	return [...text.matchAll(TOKEN)].map((match) => match[0]);
}

interface LineEdit {
	op: "equal" | "delete" | "insert";
	text: string;
}

function lineEdits(before: string[], after: string[]): LineEdit[] {
	const n = before.length;
	const m = after.length;
	const max = n + m;
	const offset = max;
	const v = new Array<number>(2 * max + 1).fill(0);
	const trace: number[][] = [];

	for (let d = 0; d <= max; d++) {
		for (let k = -d; k <= d; k += 2) {
			let x: number;
			if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) {
				x = v[offset + k + 1]!;
			} else {
				x = v[offset + k - 1]! + 1;
			}
			let y = x - k;
			while (x < n && y < m && before[x] === after[y]) {
				x++;
				y++;
			}
			v[offset + k] = x;
			if (x >= n && y >= m) {
				trace.push(v.slice());
				return replay(before, after, trace, offset);
			}
		}
		trace.push(v.slice());
	}
	return [];
}

export interface PositionEdit {
	from: number;
	to: number;
	insert: string;
}

/** Edits that turn `before` into `after`, fine enough to move a stored range. */
export function positionEdits(before: string, after: string): PositionEdit[] {
	if (before === after) return [];
	const coarse = groupEdits(lineEdits(splitLines(before), splitLines(after)));
	if (coarse.length === 0) return [{ from: 0, to: before.length, insert: after }];
	const out: PositionEdit[] = [];
	for (const edit of coarse) out.push(...refineEdit(before, edit));
	return out;
}

function groupEdits(edits: LineEdit[]): PositionEdit[] {
	const out: PositionEdit[] = [];
	let oldPos = 0;
	let index = 0;
	while (index < edits.length) {
		const edit = edits[index]!;
		if (edit.op === "equal") {
			oldPos += edit.text.length;
			index += 1;
			continue;
		}
		const from = oldPos;
		let deleted = "";
		let inserted = "";
		while (index < edits.length && edits[index]!.op !== "equal") {
			const current = edits[index]!;
			if (current.op === "delete") {
				deleted += current.text;
				oldPos += current.text.length;
			} else {
				inserted += current.text;
			}
			index += 1;
		}
		if (deleted !== inserted) out.push({ from, to: from + deleted.length, insert: inserted });
	}
	return out;
}

function refineEdit(before: string, edit: PositionEdit): PositionEdit[] {
	const deleted = before.slice(edit.from, edit.to);
	const inserted = edit.insert;
	let start = 0;
	const limit = Math.min(deleted.length, inserted.length);
	while (start < limit && deleted[start] === inserted[start]) start += 1;
	let deletedEnd = deleted.length;
	let insertedEnd = inserted.length;
	while (
		deletedEnd > start &&
		insertedEnd > start &&
		deleted[deletedEnd - 1] === inserted[insertedEnd - 1]
	) {
		deletedEnd -= 1;
		insertedEnd -= 1;
	}
	const oldMid = deleted.slice(start, deletedEnd);
	const newMid = inserted.slice(start, insertedEnd);
	const at = edit.from + start;
	if (!oldMid && !newMid) return [];
	if (!oldMid || !newMid || oldMid.length * newMid.length > 250_000) {
		return [{ from: at, to: at + oldMid.length, insert: newMid }];
	}
	const fine = groupEdits(lineEdits([...oldMid], [...newMid]));
	if (fine.length === 0) return [{ from: at, to: at + oldMid.length, insert: newMid }];
	return fine.map((piece) => ({
		from: piece.from + at,
		to: piece.to + at,
		insert: piece.insert,
	}));
}

function replay(before: string[], after: string[], trace: number[][], offset: number): LineEdit[] {
	let x = before.length;
	let y = after.length;
	const edits: LineEdit[] = [];
	for (let d = trace.length - 1; d >= 0; d--) {
		if (d === 0) {
			while (x > 0 && y > 0) {
				edits.push({ op: "equal", text: before[x - 1]! });
				x--;
				y--;
			}
			break;
		}
		const k = x - y;
		const prev = trace[d - 1]!;
		const down = k === -d || (k !== d && prev[offset + k - 1]! < prev[offset + k + 1]!);
		const prevK = down ? k + 1 : k - 1;
		const prevX = prev[offset + prevK]!;
		const prevY = prevX - prevK;
		while (x > prevX && y > prevY) {
			edits.push({ op: "equal", text: before[x - 1]! });
			x--;
			y--;
		}
		if (down) {
			edits.push({ op: "insert", text: after[y - 1]! });
			y--;
		} else {
			edits.push({ op: "delete", text: before[x - 1]! });
			x--;
		}
	}
	while (x > 0) {
		edits.push({ op: "delete", text: before[x - 1]! });
		x--;
	}
	while (y > 0) {
		edits.push({ op: "insert", text: after[y - 1]! });
		y--;
	}
	edits.reverse();
	return edits;
}
