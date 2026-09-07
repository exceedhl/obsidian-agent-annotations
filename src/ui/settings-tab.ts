import { PluginSettingTab, Setting, type App } from "obsidian";
import { DEFAULT_SETTINGS } from "../settings";
import type AgentAnnotationsPlugin from "../main";

export class AgentAnnotationsSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: AgentAnnotationsPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Agent Annotations" });
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "Hotkeys while an annotation card is focused. Use Mod for ⌘ on Mac and Ctrl on Windows/Linux. The Add command can also be bound in Settings → Hotkeys.",
		});

		new Setting(containerEl)
			.setName("Save annotation")
			.setDesc("Example: Mod+Enter")
			.addText((text) => {
				text.setPlaceholder(DEFAULT_SETTINGS.saveHotkey);
				text.setValue(this.plugin.settings.saveHotkey);
				text.onChange((value) => {
					this.plugin.settings.saveHotkey = value.trim() || DEFAULT_SETTINGS.saveHotkey;
					void this.plugin.persistSettings();
					this.plugin.refreshEditors();
				});
			});

		new Setting(containerEl)
			.setName("Cancel annotation")
			.setDesc("Example: Escape")
			.addText((text) => {
				text.setPlaceholder(DEFAULT_SETTINGS.cancelHotkey);
				text.setValue(this.plugin.settings.cancelHotkey);
				text.onChange((value) => {
					this.plugin.settings.cancelHotkey = value.trim() || DEFAULT_SETTINGS.cancelHotkey;
					void this.plugin.persistSettings();
					this.plugin.refreshEditors();
				});
			});
	}
}
