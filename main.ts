import { Notice, Plugin, TFile, requestUrl } from 'obsidian';

/** Wrap plain URLs in anchor tags; avoids doubling URLs inside href attributes. */
function autoLinkUrls(html: string): string {
  return html.replace(
    /(^|[\s>])(https?:\/\/[^\s<]+)/g,
    (_, before, url) =>
      `${before}<a href="${url}" target="_blank" rel="noopener" class="gus-link">${url}</a>`,
  );
}
import { DEFAULT_SETTINGS, SettingsTab } from './src/settings';
import type { PluginSettings } from './src/settings';
import { completeTask, createTask, fetchTasks, parseBlockConfig, sourceLabel } from './src/omnifocus';
import type { OmniFocusTask, TaskSource } from './src/omnifocus';
import { AddTaskModal } from './src/add-task-modal';
import {
  getAuthenticatedClient,
  loginViaBrowser,
  queryWorkItems,
} from './src/gus';
import type { RequestFn, TokenStorage } from './src/gus';

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

      let config: { source: TaskSource; showCompleted: boolean } | null;
      try {
        config = parseBlockConfig(source);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        container.createEl('p', {
          text: message,
          cls: 'omnifocus-error',
        });
        return;
      }

      if (config === null) {
        const usage = container.createDiv({ cls: 'omnifocus-usage' });
        usage.createEl('p', { text: 'OmniFocus — specify a source:' });
        const list = usage.createEl('ul');
        list.createEl('li', { text: 'inbox' });
        list.createEl('li', { text: 'project: <name>' });
        list.createEl('li', { text: 'tag: <name>' });
        usage.createEl('p', {
          text: 'Add "showCompleted" on a second line to include completed tasks.',
        });
        return;
      }

      const taskSource = config.source;
      const label = sourceLabel(taskSource);

      const btnRow = container.createDiv({ cls: 'omnifocus-btn-row' });
      const addBtn = btnRow.createEl('button', {
        text: 'Add task',
        cls: 'omnifocus-add-btn',
      });
      const btn = btnRow.createEl('button', {
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
          const sorted = [...tasks].sort(
            (a, b) => (a.completed ? 1 : 0) - (b.completed ? 1 : 0),
          );
          for (const task of sorted) {
            const li = listEl.createEl('li', {
              cls: task.completed ? 'omnifocus-task-item omnifocus-task-item--completed' : 'omnifocus-task-item',
            });
            if (task.completed) {
              const marker = li.createSpan({
                cls: 'omnifocus-task-completed-marker',
                text: '☑',
              });
              marker.title = 'Completed';
            } else {
              const checkbox = li.createEl('input', {
                cls: 'omnifocus-task-checkbox',
              });
              checkbox.type = 'checkbox';
              checkbox.title = 'Mark complete';
              checkbox.addEventListener('change', async () => {
                checkbox.disabled = true;
                try {
                  await completeTask(task.id);
                  new Notice('Task completed.');
                  doFetch();
                } catch (err) {
                  const message = err instanceof Error ? err.message : String(err);
                  console.error('OmniFocus complete task failed:', err);
                  new Notice(`OmniFocus error: ${message}`);
                  checkbox.checked = false;
                  checkbox.disabled = false;
                }
              });
            }
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
          const tasks = await fetchTasks(taskSource, {
            includeCompleted: config.showCompleted,
          });
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

      addBtn.addEventListener('click', () => {
        new AddTaskModal(this.app, taskSource, async (title, note) => {
          await createTask(taskSource, title, note);
          new Notice(`Created task in ${label}.`);
          doFetch();
        }).open();
      });

      // Auto-fetch on render
      doFetch();
    });

    // GUS work item code block
    this.registerMarkdownCodeBlockProcessor('gus', (source, el) => {
      const container = el.createDiv({ cls: 'gus-container' });
      const workItemId = source.trim();

      if (!workItemId) {
        container.createEl('p', {
          text: 'Enter a work item ID (e.g. W-12345)',
          cls: 'gus-usage',
        });
        return;
      }

      const gusTokenStorage: TokenStorage = {
        get: () => this.loadData().then((d) => d?.gusToken ?? null),
        set: (data) =>
          this.loadData().then((d) =>
            this.saveData({ ...(d ?? {}), gusToken: data }),
          ),
      };

      const openBrowser = (url: string) => {
        if (typeof require !== 'undefined') {
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            require('electron').shell.openExternal(url);
          } catch {
            window.open(url);
          }
        } else {
          window.open(url);
        }
      };

      const gusRequestFn: RequestFn = async (url, options) => {
        const res = await requestUrl({
          url,
          method: options?.method ?? 'GET',
          headers: options?.headers,
          body: options?.body,
          throw: false,
        });
        return {
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          json: () => Promise.resolve(res.json),
        };
      };

      const renderLoading = () => {
        container.empty();
        container.createDiv({ cls: 'gus-loading', text: 'Loading work item...' });
      };

      const renderError = (message: string) => {
        container.empty();
        container.createEl('p', { text: message, cls: 'gus-error' });
      };

      const renderLoginNeeded = () => {
        container.empty();
        container.createEl('p', {
          text: 'Login to GUS to view work items.',
          cls: 'gus-login-prompt',
        });
        const btn = container.createEl('button', {
          text: 'Login to GUS',
          cls: 'gus-login-btn',
        });
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const token = await loginViaBrowser({
              openBrowser,
              requestFn: gusRequestFn,
            });
            await gusTokenStorage.set({
              accessToken: token.access_token,
              instanceUrl: token.instance_url,
              timeCollected: new Date().toISOString(),
            });
            new Notice('GUS login successful.');
            doFetch();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            new Notice(`GUS login failed: ${message}`);
            renderError(message);
          } finally {
            btn.disabled = false;
          }
        });
      };

      const renderWorkItem = (item: {
        name: string;
        subject: string;
        status: string;
        description?: string;
      }) => {
        container.empty();
        const header = container.createDiv({ cls: 'gus-header' });
        header.createEl('span', {
          text: `${item.name}: ${item.subject}`,
          cls: 'gus-title',
        });
        header.createEl('span', {
          text: item.status,
          cls: 'gus-status',
        });
        if (item.description) {
          const descEl = container.createDiv({ cls: 'gus-description' });
          descEl.innerHTML = autoLinkUrls(item.description);
        }
      };

      const doFetch = async () => {
        renderLoading();
        const cached = await gusTokenStorage.get();
        const maxAgeMs = 8 * 60 * 60 * 1000;
        const isValid =
          cached &&
          Date.now() - new Date(cached.timeCollected).getTime() < maxAgeMs;

        if (!isValid) {
          renderLoginNeeded();
          return;
        }

        try {
          const { accessToken, instanceUrl } = await getAuthenticatedClient({
            tokenStorage: gusTokenStorage,
            openBrowser,
            requestFn: gusRequestFn,
          });
          const escapedId = workItemId.replace(/'/g, "''");
          const soql = `SELECT Id, Name, Subject__c, Status__c, Details__c FROM ADM_Work__c WHERE Name = '${escapedId}'`;
          const items = await queryWorkItems(
            accessToken,
            instanceUrl,
            soql,
            gusRequestFn,
          );
          if (items.length === 0) {
            renderError(`Work item not found: ${workItemId}`);
          } else {
            renderWorkItem(items[0]);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          renderError(message);
          console.error('GUS fetch failed:', err);
        }
      };

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
