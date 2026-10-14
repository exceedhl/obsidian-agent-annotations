export interface TextHunk {
	before: string;
	after: string;
	/** Index of `after` in the new document. A deletion is a caret at `at`. */
	at: number;
}

const TOKEN = /[A-Za-z0-9_]+|\s+|[^\sA-Za-z0-9_]/gu;

/**
 * One replacement for the whole edit. Matching characters inside that span
 * stay inside it, so the revised text is not cut into extra entries.
 */
export function diffHunks(before: string, after: string): TextHunk[] {
	if (before === after) return [];
	const left = tokenize(before);
	const right = tokenize(after);
	let prefix = 0;
	const limit = Math.min(left.length, right.length);
	while (prefix < limit && left[prefix] === right[prefix]) prefix += 1;

	let leftEnd = left.length;
	let rightEnd = right.length;
	while (leftEnd > prefix && rightEnd > prefix && left[leftEnd - 1] === right[rightEnd - 1]) {
		leftEnd -= 1;
		rightEnd -= 1;
	}

	const hunk: TextHunk = {
		before: left.slice(prefix, leftEnd).join(""),
		after: right.slice(prefix, rightEnd).join(""),
		at: right.slice(0, prefix).join("").length,
	};
	if (hunk.before.trim() === hunk.after.trim()) return [];
	return [hunk];
}

function tokenize(text: string): string[] {
	if (!text) return [];
	return [...text.matchAll(TOKEN)].map((match) => match[0]);
}
