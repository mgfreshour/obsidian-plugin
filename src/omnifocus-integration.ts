/**
 * OmniFocus Obsidian integration.
 *
 * Registers the omnifocus code block processor, command, ribbon icon,
 * and auto-sync interval.
 */

import { Notice, TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { PluginSettings } from './settings';
import { completeTask, createTask, fetchTasks, parseBlockConfig, sourceLabel } from './omnifocus';
import type { OmniFocusTask, TaskSource } from './omnifocus';
import { AddTaskModal } from './add-task-modal';

const INBOX_FILE = 'Sample Note.md';

/** Plugin context required for OmniFocus integration. */
export interface OmnifocusPluginContext {
  app: App;
  settings: PluginSettings;
  addCommand(command: { id: string; name: string; callback: () => void }): void;
  addRibbonIcon(icon: string, title: string, onClick: () => void): void;
  registerInterval(id: number): void;
  registerMarkdownCodeBlockProcessor(
    language: string,
    processor: (source: string, el: HTMLElement) => void | Promise<void>,
  ): void;
}

/** Fetch OmniFocus inbox and write to the inbox file. */
async function syncInbox(plugin: OmnifocusPluginContext): Promise<void> {
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

    const file = plugin.app.vault.getAbstractFileByPath(INBOX_FILE);
    if (file instanceof TFile) {
      await plugin.app.vault.modify(file, content);
    } else {
      await plugin.app.vault.create(INBOX_FILE, content);
    }

    new Notice(`Fetched ${tasks.length} task(s) from OmniFocus inbox.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    new Notice(`OmniFocus error: ${message}`);
    console.error('OmniFocus fetch failed:', err);
  }
}

/**
 * Register OmniFocus integration: command, ribbon icon, sync interval, and code block processor.
 */
export function registerOmniFocusIntegration(plugin: OmnifocusPluginContext): void {
  plugin.addCommand({
    id: 'fetch-omnifocus-inbox',
    name: 'Fetch OmniFocus Inbox',
    callback: () => syncInbox(plugin),
  });

  plugin.addRibbonIcon('refresh-cw', 'Sync OmniFocus Inbox', () => {
    syncInbox(plugin);
  });

  const minutes = plugin.settings.syncIntervalMinutes;
  if (minutes > 0) {
    const ms = minutes * 60 * 1000;
    plugin.registerInterval(window.setInterval(() => syncInbox(plugin), ms));
  }

  plugin.registerMarkdownCodeBlockProcessor('omnifocus', (source, el) => {
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
      new AddTaskModal(plugin.app, taskSource, async (title, note) => {
        await createTask(taskSource, title, note);
        new Notice(`Created task in ${label}.`);
        doFetch();
      }).open();
    });

    // Auto-fetch on render
    doFetch();
  });
}
