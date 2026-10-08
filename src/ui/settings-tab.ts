import { PluginSettingTab, type App, type SettingDefinitionItem } from "obsidian";
import { DEFAULT_SETTINGS } from "../settings";
import type AgentAnnotationsPlugin from "../main";

const HOTKEY_HINT =
	"Hotkeys while an annotation card is focused. Use Mod for ⌘ on Mac and Ctrl on Windows/Linux. The Add command can also be bound in Settings → Hotkeys.";

export class AgentAnnotationsSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: AgentAnnotationsPlugin,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: "group",
				heading: "Agent Annotations",
				items: [
					{
						name: "Save annotation",
						desc: `${HOTKEY_HINT} Example: Mod+Enter`,
						control: {
							type: "text",
							key: "saveHotkey",
							placeholder: DEFAULT_SETTINGS.saveHotkey,
						},
					},
					{
						name: "Cancel annotation",
						desc: "Example: Escape",
						control: {
							type: "text",
							key: "cancelHotkey",
							placeholder: DEFAULT_SETTINGS.cancelHotkey,
						},
					},
				],
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key !== "saveHotkey" && key !== "cancelHotkey") {
			await super.setControlValue(key, value);
			return;
		}
		const fallback = DEFAULT_SETTINGS[key];
		const next = typeof value === "string" && value.trim() ? value.trim() : fallback;
		this.plugin.settings[key] = next;
		await this.plugin.persistSettings();
		this.plugin.refreshEditors();
	}
}
