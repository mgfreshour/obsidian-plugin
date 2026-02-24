import { Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, SettingsTab } from './src/settings';
import type { PluginSettings } from './src/settings';
import { fetchInboxTasks } from './src/omnifocus';

export default class ObsidianPlugin extends Plugin {
  settings!: PluginSettings;

  async onload() {
    console.log('Loading Obsidian Plugin');

    await this.loadSettings();
    this.addSettingTab(new SettingsTab(this.app, this));

    this.addCommand({
      id: 'fetch-omnifocus-inbox',
      name: 'Fetch OmniFocus Inbox',
      callback: async () => {
        try {
          const tasks = await fetchInboxTasks();

          const lines = ['# OmniFocus Inbox', ''];
          if (tasks.length === 0) {
            lines.push('*No tasks in inbox.*');
          } else {
            for (const task of tasks) {
              lines.push(`- ${task}`);
            }
          }
          const content = lines.join('\n') + '\n';

          const path = 'Sample Note.md';
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file) {
            await this.app.vault.modify(file as import('obsidian').TFile, content);
          } else {
            await this.app.vault.create(path, content);
          }

          new Notice(`Fetched ${tasks.length} task(s) from OmniFocus inbox.`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          new Notice(`OmniFocus error: ${message}`);
          console.error('OmniFocus fetch failed:', err);
        }
      },
    });
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
