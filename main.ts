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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
