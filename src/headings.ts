const HEADING_RE = /^(#{1,6})\s+(.*)$/;

export function headingPathFromSource(doc: string, pos: number): string[] {
	const stack: { level: number; text: string }[] = [];
	let offset = 0;
	let cursor = 0;

	while (cursor <= doc.length && offset <= pos) {
		const next = doc.indexOf("\n", cursor);
		const end = next === -1 ? doc.length : next;
		const line = doc.slice(cursor, end);
		pushHeading(stack, line);
		offset = end + 1;
		if (next === -1) break;
		cursor = next + 1;
	}

	return stack.map((item) => item.text);
}

function pushHeading(
	stack: { level: number; text: string }[],
	line: string,
): void {
	const match = HEADING_RE.exec(line);
	if (!match) return;
	const level = match[1]!.length;
	const text = match[2]!.trim();
	while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
		stack.pop();
	}
	stack.push({ level, text });
}

export function headingPathsEqual(a: string[] | undefined, b: string[] | undefined): boolean {
	if (!a?.length || !b?.length) return false;
	if (a.length !== b.length) return false;
	return a.every((item, index) => item === b[index]);
}
