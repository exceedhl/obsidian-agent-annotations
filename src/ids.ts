export function generateId(existing: Iterable<string>, prefix = "a_"): string {
	const taken = existing instanceof Set ? existing : new Set(existing);
	for (let i = 0; i < 24; i++) {
		const id = `${prefix}${Math.random().toString(36).slice(2, 8)}`;
		if (!taken.has(id)) return id;
	}
	return `${prefix}${Date.now().toString(36)}`;
}
