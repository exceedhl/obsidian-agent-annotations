import type { Annotation, AnnotationFile, ParseResult } from "./types";
import { SCHEMA_VERSION } from "./types";

export function emptyAnnotationFile(): AnnotationFile {
	return { version: SCHEMA_VERSION, annotations: [] };
}

export function serializeAnnotationFile(file: AnnotationFile): string {
	return `${JSON.stringify(sanitizeFile(file), null, 2)}\n`;
}

export function parseAnnotationFile(raw: string): ParseResult {
	const trimmed = raw.trim();
	if (!trimmed) return { ok: true, data: emptyAnnotationFile() };

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return { ok: false, error: "JSON parse error" };
	}

	if (!isAnnotationFile(parsed)) {
		return { ok: false, error: "Invalid schema: expected { version: 1, annotations: [] }" };
	}

	return { ok: true, data: sanitizeFile(parsed) };
}

export function writeBack(file: AnnotationFile, successfulIds: Iterable<string>): AnnotationFile {
	const done = successfulIds instanceof Set ? successfulIds : new Set(successfulIds);
	return {
		version: SCHEMA_VERSION,
		annotations: file.annotations.filter((item) => !done.has(item.id)),
	};
}

export function isAnnotationFile(value: unknown): value is AnnotationFile {
	if (!isRecord(value)) return false;
	if (value.version !== SCHEMA_VERSION) return false;
	if (!Array.isArray(value.annotations)) return false;
	return value.annotations.every(isAnnotation);
}

export function isAnnotation(value: unknown): value is Annotation {
	if (!isRecord(value)) return false;
	if (typeof value.id !== "string" || value.id.length === 0) return false;
	if (typeof value.file !== "string" || value.file.length === 0) return false;
	if (typeof value.instruction !== "string") return false;
	if (typeof value.selectedText !== "string") return false;
	if (value.headingPath !== undefined && !isStringArray(value.headingPath)) return false;
	if (value.prefix !== undefined && typeof value.prefix !== "string") return false;
	if (value.suffix !== undefined && typeof value.suffix !== "string") return false;
	return true;
}

function sanitizeFile(file: AnnotationFile): AnnotationFile {
	return {
		version: SCHEMA_VERSION,
		annotations: file.annotations.map(sanitizeAnnotation),
	};
}

function sanitizeAnnotation(item: Annotation): Annotation {
	const next: Annotation = {
		id: item.id,
		file: item.file.replace(/\\/g, "/"),
		instruction: item.instruction,
		selectedText: item.selectedText,
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
