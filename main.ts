import { Notice, Plugin, TFile } from 'obsidian';
import { DEFAULT_SETTINGS, SettingsTab } from './src/settings';
import type { PluginSettings } from './src/settings';
import { fetchInboxTasks } from './src/omnifocus';

const INBOX_FILE = 'Sample Note.md';

export default class ObsidianPlugin extends Plugin {
  settings!: PluginSettings;

  async onload() {
    console.log('Loading Obsidian Plugin');

    await this.loadSettings();
    this.addSettingTab(new SettingsTab(this.app, this));

    // Command palette trigger
    this.addCommand({
      id: 'fetch-omnifocus-inbox',
      name: 'Fetch OmniFocus Inbox',
      callback: () => this.syncInbox(),
    });

    // Ribbon icon trigger
    this.addRibbonIcon('refresh-cw', 'Sync OmniFocus Inbox', () => {
      this.syncInbox();
    });

    // Periodic interval trigger
    this.registerSyncInterval();

    // In-document code block trigger
    this.registerMarkdownCodeBlockProcessor('omnifocus', (source, el) => {
      const container = el.createDiv({ cls: 'omnifocus-container' });

      const btn = container.createEl('button', {
        text: 'Sync OmniFocus',
        cls: 'omnifocus-sync-btn',
      });

      const listEl = container.createEl('ul', { cls: 'omnifocus-task-list' });

      const renderTasks = (tasks: string[]) => {
        listEl.empty();
        if (tasks.length === 0) {
          const empty = container.createEl('p', {
            text: 'No tasks in inbox.',
            cls: 'omnifocus-empty',
          });
          listEl.replaceWith(empty);
        } else {
          for (const task of tasks) {
            listEl.createEl('li', { text: task });
          }
        }
      };

      const doFetch = async () => {
        btn.disabled = true;
        btn.setText('Syncing...');
        try {
          const tasks = await fetchInboxTasks();
          renderTasks(tasks);
        } catch (err) {
          listEl.empty();
          const message = err instanceof Error ? err.message : String(err);
          listEl.createEl('li', { text: `Error: ${message}` });
        } finally {
          btn.disabled = false;
          btn.setText('Sync OmniFocus');
        }
      };

      btn.addEventListener('click', doFetch);

      // Auto-fetch on render
      doFetch();
    });
  }

  onunload() {
    console.log('Unloading Obsidian Plugin');
  }

  /** Fetch OmniFocus inbox and write to the inbox file. */
  async syncInbox() {
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

      const file = this.app.vault.getAbstractFileByPath(INBOX_FILE);
      if (file instanceof TFile) {
        await this.app.vault.modify(file, content);
      } else {
        await this.app.vault.create(INBOX_FILE, content);
      }

      new Notice(`Fetched ${tasks.length} task(s) from OmniFocus inbox.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`OmniFocus error: ${message}`);
      console.error('OmniFocus fetch failed:', err);
    }
  }

  /** Register the auto-sync interval based on settings. */
  private registerSyncInterval() {
    const minutes = this.settings.syncIntervalMinutes;
    if (minutes > 0) {
      const ms = minutes * 60 * 1000;
      this.registerInterval(window.setInterval(() => this.syncInbox(), ms));
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
