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
  syncIntervalMinutes: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  textValue: '',
  syncIntervalMinutes: 5,
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

    containerEl.createEl('h2', { text: 'OmniFocus Sync' });

    new Setting(containerEl)
      .setName('Sync interval (minutes)')
      .setDesc('How often to auto-sync the OmniFocus inbox. Set to 0 to disable.')
      .addText((text) =>
        text
          .setPlaceholder('5')
          .setValue(String(this.plugin.settings.syncIntervalMinutes))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            this.plugin.settings.syncIntervalMinutes = isNaN(parsed) ? 0 : Math.max(0, parsed);
            await this.plugin.saveSettings();
          }),
      );

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
