export interface Annotation {
	id: string;
	file: string;
	instruction: string;
	selectedText: string;
	headingPath?: string[];
	/** Character offsets in `file`. `-1` means the range is not known yet. */
	from: number;
	to: number;
	/** Legacy context. Kept only until `from`/`to` are filled, then dropped. */
	prefix?: string;
	suffix?: string;
}

export interface AnnotationFile {
	version: 1;
	annotations: Annotation[];
}

export interface TextRange {
	from: number;
	to: number;
}

export interface DraftAnnotation {
	from: number;
	to: number;
	selectedText: string;
	headingPath: string[];
	prefix: string;
	suffix: string;
}

export interface AppliedChange {
	id: string;
	file: string;
	before: string;
	after: string;
	headingPath?: string[];
	prefix?: string;
	suffix?: string;
	/** Offsets of `after` in the note. A deletion is a caret (`from === to`). `-1` if unknown. */
	from: number;
	to: number;
}

export interface AppliedFile {
	version: 1;
	changes: AppliedChange[];
}

export interface EditorUiState {
	draft: DraftAnnotation | null;
	editingId: string | null;
	flashId: string | null;
}

export type ParseResult<T = AnnotationFile> =
	| { ok: true; data: T }
	| { ok: false; error: string };

export const CONTEXT_RADIUS = 40;
export const SCHEMA_VERSION = 1 as const;
