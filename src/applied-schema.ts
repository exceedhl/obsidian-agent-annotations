import type { AppliedChange, AppliedFile, ParseResult } from "./types";
import { SCHEMA_VERSION } from "./types";

export function emptyAppliedFile(): AppliedFile {
	return { version: SCHEMA_VERSION, changes: [] };
}

export function serializeAppliedFile(file: AppliedFile): string {
	return `${JSON.stringify(sanitizeFile(file), null, 2)}\n`;
}

export function parseAppliedFile(raw: string): ParseResult<AppliedFile> {
	const trimmed = raw.trim();
	if (!trimmed) return { ok: true, data: emptyAppliedFile() };

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return { ok: false, error: "JSON parse error" };
	}

	if (!isAppliedFile(parsed)) {
		return { ok: false, error: "Invalid schema: expected { version: 1, changes: [] }" };
	}

	return { ok: true, data: sanitizeFile(parsed) };
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
	return true;
}

function sanitizeFile(file: AppliedFile): AppliedFile {
	return {
		version: SCHEMA_VERSION,
		changes: file.changes.map(sanitizeChange).filter((item) => item.before || item.after),
	};
}

function sanitizeChange(item: AppliedChange): AppliedChange {
	const next: AppliedChange = {
		id: item.id,
		file: item.file.replace(/\\/g, "/"),
		before: item.before,
		after: item.after,
	};
	if (item.headingPath?.length) next.headingPath = [...item.headingPath];
	if (item.prefix) next.prefix = item.prefix;
	if (item.suffix) next.suffix = item.suffix;
	return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}
