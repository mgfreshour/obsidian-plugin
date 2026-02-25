import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, SettingsTab } from './src/settings';
import type { PluginSettings } from './src/settings';
import { registerGusIntegration } from './src/gus-integration';
import { registerOmniFocusIntegration } from './src/omnifocus-integration';

export default class ObsidianPlugin extends Plugin {
  settings!: PluginSettings;

  async onload() {
    console.log('Loading Obsidian Plugin');

    await this.loadSettings();
    this.addSettingTab(new SettingsTab(this.app, this));

    registerOmniFocusIntegration(this);
    registerGusIntegration(this);
  }

  onunload() {
    console.log('Unloading Obsidian Plugin');
  }

  async loadSettings() {
    const raw = await this.loadData();
    const migrated = raw as Record<string, unknown>;
    if (
      migrated?.openRouterApiKey != null &&
      (migrated.llmProvider == null || migrated.llmApiKey == null)
    ) {
      migrated.llmProvider = 'openrouter';
      migrated.llmApiKey = String(migrated.openRouterApiKey);
      migrated.llmBaseUrl = migrated.llmBaseUrl ?? '';
      migrated.llmModel = migrated.llmModel ?? '';
      delete migrated.openRouterApiKey;
    }
    if (migrated.llmModelUserStory == null && migrated.llmModel != null) {
      migrated.llmModelUserStory = migrated.llmModel;
    }
    this.settings = Object.assign({}, DEFAULT_SETTINGS, migrated);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
