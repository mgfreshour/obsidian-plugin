/**
 * Settings module for the Obsidian Plugin.
 *
 * - `PluginSettings` defines the shape of persisted settings.
 * - `DEFAULT_SETTINGS` provides fallback values for missing or new fields.
 * - `SettingsTab` renders the settings UI and writes changes back via
 *   `plugin.saveSettings()`.
 *
 * Settings are persisted to `data.json` in the plugin directory via
 * Obsidian's `loadData()` / `saveData()`.
 */

import { App, PluginSettingTab, Setting } from 'obsidian';
import type ObsidianPlugin from '../main';

export interface PluginSettings {
  textValue: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  textValue: '',
};

export class SettingsTab extends PluginSettingTab {
  plugin: ObsidianPlugin;

  constructor(app: App, plugin: ObsidianPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Hello World' });

    new Setting(containerEl)
      .setName('Text value')
      .setDesc('Enter a value to store.')
      .addText((text) =>
        text
          .setPlaceholder('Type something...')
          .setValue(this.plugin.settings.textValue)
          .onChange(async (value) => {
            this.plugin.settings.textValue = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
