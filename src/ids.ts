export function generateId(existing: Iterable<string>): string {
	const taken = existing instanceof Set ? existing : new Set(existing);
	for (let i = 0; i < 24; i++) {
		const id = `a_${Math.random().toString(36).slice(2, 8)}`;
		if (!taken.has(id)) return id;
	}
	return `a_${Date.now().toString(36)}`;
}
