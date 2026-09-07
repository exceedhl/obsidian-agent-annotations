export interface Annotation {
	id: string;
	file: string;
	instruction: string;
	selectedText: string;
	headingPath?: string[];
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

export interface EditorUiState {
	draft: DraftAnnotation | null;
	editingId: string | null;
	flashId: string | null;
}

export type ParseResult =
	| { ok: true; data: AnnotationFile }
	| { ok: false; error: string };

export const CONTEXT_RADIUS = 40;
export const SCHEMA_VERSION = 1 as const;
