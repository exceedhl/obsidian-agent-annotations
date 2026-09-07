export interface PluginSettings {
	reviewMode: boolean;
	saveHotkey: string;
	cancelHotkey: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	reviewMode: false,
	saveHotkey: "Mod+Enter",
	cancelHotkey: "Escape",
};

export function mergeSettings(raw: unknown): PluginSettings {
	const data = raw && typeof raw === "object" ? (raw as Partial<PluginSettings>) : {};
	return {
		reviewMode: data.reviewMode ?? DEFAULT_SETTINGS.reviewMode,
		saveHotkey: data.saveHotkey?.trim() || DEFAULT_SETTINGS.saveHotkey,
		cancelHotkey: data.cancelHotkey?.trim() || DEFAULT_SETTINGS.cancelHotkey,
	};
}
