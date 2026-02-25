import { Notice, Plugin, TFile } from 'obsidian';
import { DEFAULT_SETTINGS, SettingsTab } from './src/settings';
import type { PluginSettings } from './src/settings';
import { fetchTasks, parseSource, sourceLabel } from './src/omnifocus';
import type { OmniFocusTask, TaskSource } from './src/omnifocus';

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

      let taskSource: TaskSource | null;
      try {
        taskSource = parseSource(source);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        container.createEl('p', {
          text: message,
          cls: 'omnifocus-error',
        });
        return;
      }

      if (taskSource === null) {
        const usage = container.createDiv({ cls: 'omnifocus-usage' });
        usage.createEl('p', { text: 'OmniFocus — specify a source:' });
        const list = usage.createEl('ul');
        list.createEl('li', { text: 'inbox' });
        list.createEl('li', { text: 'project: <name>' });
        list.createEl('li', { text: 'tag: <name>' });
        return;
      }

      const label = sourceLabel(taskSource);

      const btn = container.createEl('button', {
        text: `Sync OmniFocus ${label}`,
        cls: 'omnifocus-sync-btn',
      });

      const listWrapper = container.createDiv({ cls: 'omnifocus-list-wrapper' });
      let listEl = listWrapper.createEl('ul', { cls: 'omnifocus-task-list' });

      const renderTasks = (tasks: OmniFocusTask[]) => {
        listWrapper.empty();
        listEl = listWrapper.createEl('ul', { cls: 'omnifocus-task-list' });
        if (tasks.length === 0) {
          const empty = listWrapper.createEl('p', {
            text: `No tasks in ${label}.`,
            cls: 'omnifocus-empty',
          });
          listEl.replaceWith(empty);
        } else {
          for (const task of tasks) {
            const li = listEl.createEl('li', { cls: 'omnifocus-task-item' });
            li.createSpan({ text: task.name, cls: 'omnifocus-task-name' });
            if (task.note) {
              const toggle = li.createSpan({
                cls: 'omnifocus-task-note-toggle',
                text: '[+]',
              });
              const noteEl = li.createDiv({ cls: 'omnifocus-task-note' });
              noteEl.setText(task.note);
              noteEl.style.display = 'none';
              toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = noteEl.style.display === 'none';
                noteEl.style.display = isOpen ? 'block' : 'none';
                toggle.setText(isOpen ? '[-]' : '[+]');
              });
            }
            const link = li.createEl('a', {
              href: `omnifocus:///task/${task.id}`,
              cls: 'omnifocus-task-link',
              title: 'Open in OmniFocus',
            });
            link.setText('↗');
            link.addEventListener('click', (e) => {
              e.preventDefault();
              require('electron').shell.openExternal(`omnifocus:///task/${task.id}`);
            });
          }
        }
      };

      const doFetch = async () => {
        btn.disabled = true;
        btn.setText('Syncing...');
        try {
          const tasks = await fetchTasks(taskSource);
          renderTasks(tasks);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          listWrapper.empty();
          listEl = listWrapper.createEl('ul', { cls: 'omnifocus-task-list' });
          listEl.createEl('li', { text: `Error: ${message}`, cls: 'omnifocus-error' });
        } finally {
          btn.disabled = false;
          btn.setText(`Sync OmniFocus ${label}`);
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
      const tasks = await fetchTasks({ kind: 'inbox' });

      const lines = ['# OmniFocus Inbox', ''];
      if (tasks.length === 0) {
        lines.push('*No tasks in inbox.*');
      } else {
        for (const task of tasks) {
          lines.push(`- [${task.name}](omnifocus:///task/${task.id}) ↗`);
          if (task.note) {
            const noteLines = task.note.split('\n');
            for (const nl of noteLines) {
              lines.push(`  ${nl}`);
            }
          }
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
