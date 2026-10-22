import { readRange } from "./offsets";
import type { AppliedChange, AppliedFile, ParseResult } from "./types";
import { SCHEMA_VERSION } from "./types";

export function emptyAppliedFile(): AppliedFile {
	return { version: SCHEMA_VERSION, changes: [] };
}

export function serializeAppliedFile(file: AppliedFile): string {
	const clean = sanitizeFile(file);
	return `${JSON.stringify(
		{
			version: clean.version,
			changes: clean.changes.map(changeJson),
		},
		null,
		2,
	)}\n`;
}

export function parseAppliedFile(raw: string): ParseResult<AppliedFile> {
	const trimmed = raw.trim();
	if (!trimmed) return { ok: true, data: emptyAppliedFile() };

	let parsed: unknown;
	try {
		parsed = parseJsonValue(trimmed);
	} catch {
		return { ok: false, error: "JSON parse error" };
	}

	if (!isAppliedFile(parsed)) {
		return { ok: false, error: "Invalid schema: expected { version: 1, changes: [] }" };
	}

	return { ok: true, data: sanitizeFile(parsed) };
}

function parseJsonValue(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch (error) {
		if (!(error instanceof SyntaxError)) throw error;
		const end = endOfFirstValue(text);
		if (end === null) throw error;
		return JSON.parse(text.slice(0, end));
	}
}

function endOfFirstValue(text: string): number | null {
	let start = 0;
	while (start < text.length && /\s/.test(text[start]!)) start += 1;
	let depth = 0;
	let inString = false;
	let escape = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i]!;
		if (inString) {
			if (escape) escape = false;
			else if (ch === "\\") escape = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') {
			inString = true;
			continue;
		}
		if (ch === "{" || ch === "[") depth += 1;
		else if (ch === "}" || ch === "]") {
			depth -= 1;
			if (depth === 0) return i + 1;
		}
	}
	return null;
}

function isAppliedFile(value: unknown): value is AppliedFile {
	if (!isRecord(value)) return false;
	if (value.version !== SCHEMA_VERSION) return false;
	if (!Array.isArray(value.changes)) return false;
	return value.changes.every(isAppliedChange);
}

function isAppliedChange(value: unknown): value is AppliedChange {
	if (!isRecord(value)) return false;
	if (typeof value.id !== "string" || value.id.length === 0) return false;
	if (typeof value.file !== "string" || value.file.length === 0) return false;
	if (typeof value.before !== "string" || typeof value.after !== "string") return false;
	if (!value.before && !value.after) return false;
	if (value.headingPath !== undefined && !isStringArray(value.headingPath)) return false;
	if (value.prefix !== undefined && typeof value.prefix !== "string") return false;
	if (value.suffix !== undefined && typeof value.suffix !== "string") return false;
	if (value.from !== undefined && typeof value.from !== "number") return false;
	if (value.to !== undefined && typeof value.to !== "number") return false;
	return true;
}

function sanitizeFile(file: AppliedFile): AppliedFile {
	return {
		version: SCHEMA_VERSION,
		changes: file.changes.map(sanitizeChange).filter((item) => item.before || item.after),
	};
}

function sanitizeChange(item: AppliedChange): AppliedChange {
	const range = readRange(item);
	const next: AppliedChange = {
		id: item.id,
		file: item.file.replace(/\\/g, "/"),
		before: item.before,
		after: item.after,
		from: range.from,
		to: range.to,
	};
	if (item.headingPath?.length) next.headingPath = [...item.headingPath];
	if (item.prefix) next.prefix = item.prefix;
	if (item.suffix) next.suffix = item.suffix;
	return next;
}

function changeJson(item: AppliedChange): Record<string, unknown> {
	const out: Record<string, unknown> = {
		id: item.id,
		file: item.file,
		before: item.before,
		after: item.after,
	};
	if (item.headingPath?.length) out.headingPath = item.headingPath;
	if (item.prefix) out.prefix = item.prefix;
	if (item.suffix) out.suffix = item.suffix;
	if (item.from >= 0 && item.to >= item.from) {
		out.from = item.from;
		out.to = item.to;
	}
	return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}
