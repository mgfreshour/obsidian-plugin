/**
 * OmniFocus Obsidian integration.
 *
 * Registers the omnifocus code block processor, command, ribbon icon,
 * and auto-sync interval.
 */

import { html, render } from 'lit';
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

type OmnifocusBlockState = {
  status: 'loading' | 'ready';
  label: string;
  config: { source: TaskSource; showCompleted: boolean };
  syncing: boolean;
  tasks?: OmniFocusTask[];
  error?: string;
};

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
      render(
        html`<p class="omnifocus-error">${message}</p>`,
        container,
      );
      return;
    }

    if (config === null) {
      render(
        html`
          <div class="omnifocus-usage">
            <p>OmniFocus — specify a source:</p>
            <ul>
              <li>inbox</li>
              <li>project: &lt;name&gt;</li>
              <li>tag: &lt;name&gt;</li>
            </ul>
            <p>Add "showCompleted" on a second line to include completed tasks.</p>
          </div>
        `,
        container,
      );
      return;
    }

    const taskSource = config.source;
    const label = sourceLabel(taskSource);

    let state: OmnifocusBlockState = {
      status: 'loading',
      label,
      config,
      syncing: false,
    };

    const onNoteToggle = (e: Event) => {
      e.stopPropagation();
      const target = e.target as HTMLElement;
      const li = target.closest('.omnifocus-task-item');
      const noteEl = li?.querySelector<HTMLElement>('.omnifocus-task-note');
      if (noteEl) {
        const isOpen = noteEl.style.display === 'none';
        noteEl.style.display = isOpen ? 'block' : 'none';
        target.textContent = isOpen ? '[-]' : '[+]';
      }
    };

    const onOmniFocusLinkClick = (taskId: string) => (e: Event) => {
      e.preventDefault();
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires -- electron is provided at runtime by Obsidian
        require('electron').shell.openExternal(`omnifocus:///task/${taskId}`);
      } catch {
        window.open(`omnifocus:///task/${taskId}`);
      }
    };

    const renderBlock = () => {
      const s = state;
      const syncing = s.syncing;
      const btnLabel = syncing ? 'Syncing...' : `Sync OmniFocus ${s.label}`;

      const onSyncClick = () => {
        doFetch();
      };

      const onAddClick = () => {
        new AddTaskModal(plugin.app, taskSource, async (title, note) => {
          await createTask(taskSource, title, note);
          new Notice(`Created task in ${s.label}.`);
          doFetch();
        }).open();
      };

      const onCheckboxChange = (task: OmniFocusTask) => async (e: Event) => {
        const checkbox = e.target as HTMLInputElement;
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
      };

      const tasks = s.tasks ?? [];
      const sorted =
        tasks.length > 0
          ? [...tasks].sort(
              (a, b) => (a.completed ? 1 : 0) - (b.completed ? 1 : 0),
            )
          : [];

      render(
        html`
          <div class="omnifocus-btn-row">
            <button class="omnifocus-add-btn" ?disabled=${syncing} @click=${onAddClick}>
              Add task
            </button>
            <button
              class="omnifocus-sync-btn"
              ?disabled=${syncing}
              @click=${onSyncClick}
            >
              ${btnLabel}
            </button>
          </div>
          <div class="omnifocus-list-wrapper">
            ${s.error
              ? html`<ul class="omnifocus-task-list">
                  <li class="omnifocus-error">${s.error}</li>
                </ul>`
              : sorted.length === 0
                ? html`<p class="omnifocus-empty">No tasks in ${s.label}.</p>`
                : html`<ul class="omnifocus-task-list">
                    ${sorted.map(
                      (task) => html`
                        <li
                          class=${task.completed
                            ? 'omnifocus-task-item omnifocus-task-item--completed'
                            : 'omnifocus-task-item'}
                        >
                          ${task.completed
                            ? html`<span
                                class="omnifocus-task-completed-marker"
                                title="Completed"
                                >☑</span
                              >`
                            : html`<input
                                type="checkbox"
                                class="omnifocus-task-checkbox"
                                title="Mark complete"
                                @change=${onCheckboxChange(task)}
                              />`}
                          <span class="omnifocus-task-name">${task.name}</span>
                          ${task.note
                            ? html`
                                <span
                                  class="omnifocus-task-note-toggle"
                                  @click=${onNoteToggle}
                                  >[+]</span
                                >
                                <div
                                  class="omnifocus-task-note"
                                  style="display:none"
                                  >${task.note}</div
                                >
                              `
                            : ''}
                          <a
                            class="omnifocus-task-link"
                            href="omnifocus:///task/${task.id}"
                            title="Open in OmniFocus"
                            @click=${onOmniFocusLinkClick(task.id)}
                            >↗</a
                          >
                        </li>
                      `,
                    )}
                  </ul>`}
          </div>
        `,
        container,
      );
    };

    const doFetch = async () => {
      state = {
        status: 'loading',
        label,
        config,
        syncing: true,
      };
      renderBlock();

      try {
        const tasks = await fetchTasks(taskSource, {
          includeCompleted: config.showCompleted,
        });
        state = {
          status: 'ready',
          label,
          config,
          syncing: false,
          tasks,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        state = {
          status: 'ready',
          label,
          config,
          syncing: false,
          error: message,
        };
      }
      renderBlock();
    };

    doFetch();
  });
}
