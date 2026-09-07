export interface Chord {
	mod: boolean;
	ctrl: boolean;
	meta: boolean;
	alt: boolean;
	shift: boolean;
	key: string;
}

export function parseChord(spec: string): Chord {
	const parts = spec
		.split("+")
		.map((part) => part.trim())
		.filter(Boolean);
	const chord: Chord = {
		mod: false,
		ctrl: false,
		meta: false,
		alt: false,
		shift: false,
		key: "",
	};
	for (const part of parts) {
		const lower = part.toLowerCase();
		if (lower === "mod" || lower === "modifier") chord.mod = true;
		else if (lower === "ctrl" || lower === "control") chord.ctrl = true;
		else if (lower === "cmd" || lower === "meta" || lower === "command") chord.meta = true;
		else if (lower === "alt" || lower === "option") chord.alt = true;
		else if (lower === "shift") chord.shift = true;
		else chord.key = part;
	}
	if (!chord.key && parts.length > 0) chord.key = parts[parts.length - 1]!;
	return chord;
}

export function matchesChord(event: KeyboardEvent, spec: string, mac = isMac()): boolean {
	const chord = parseChord(spec);
	if (normalizeKey(event.key) !== normalizeKey(chord.key)) return false;
	const needMeta = chord.meta || (chord.mod && mac);
	const needCtrl = chord.ctrl || (chord.mod && !mac);
	return (
		event.metaKey === needMeta &&
		event.ctrlKey === needCtrl &&
		event.altKey === chord.alt &&
		event.shiftKey === chord.shift
	);
}

export function formatChord(spec: string, mac = isMac()): string {
	const chord = parseChord(spec);
	const bits: string[] = [];
	if (chord.mod) bits.push(mac ? "⌘" : "Ctrl");
	if (chord.meta && !chord.mod) bits.push(mac ? "⌘" : "Meta");
	if (chord.ctrl && !chord.mod) bits.push("Ctrl");
	if (chord.alt) bits.push(mac ? "⌥" : "Alt");
	if (chord.shift) bits.push(mac ? "⇧" : "Shift");
	bits.push(prettyKey(chord.key));
	return mac ? bits.join("") : bits.join("+");
}

export function isMac(): boolean {
	return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

function normalizeKey(key: string): string {
	const lower = key.toLowerCase();
	if (lower === "esc") return "escape";
	if (lower === "return") return "enter";
	if (lower === " ") return "space";
	return lower;
}

function prettyKey(key: string): string {
	const lower = key.toLowerCase();
	if (lower === "enter" || lower === "return") return "↵";
	if (lower === "escape" || lower === "esc") return "Esc";
	if (lower === " ") return "Space";
	if (key.length === 1) return key.toUpperCase();
	return key;
}
