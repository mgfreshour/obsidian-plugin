/**
 * Modal for adding a new task to OmniFocus.
 */

import { App, Modal, Notice, Setting } from 'obsidian';
import type { TaskSource } from './omnifocus';

export class AddTaskModal extends Modal {
  constructor(
    app: App,
    private readonly source: TaskSource,
    private readonly onSave: (title: string, note: string) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.containerEl.addClass('omnifocus-add-task-modal');
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Add task' });

    let titleInput: { getValue(): string };
    let noteInput: { getValue(): string };

    new Setting(contentEl)
      .setName('Title')
      .addText((text) => {
        titleInput = text;
        text.setPlaceholder('Task title');
      });

    new Setting(contentEl)
      .setName('Notes')
      .addTextArea((text) => {
        noteInput = text;
        text.setPlaceholder('Task notes (optional)');
        text.inputEl.rows = 4;
      });

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText('Cancel').onClick(() => this.close()),
      )
      .addButton((btn) =>
        btn
          .setButtonText('Save')
          .setCta()
          .onClick(async () => {
            const title = titleInput.getValue().trim();
            if (!title) {
              return;
            }
            const note = noteInput.getValue().trim();
            try {
              await this.onSave(title, note);
              this.close();
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.error('OmniFocus create task failed:', err);
              new Notice(`OmniFocus error: ${message}`);
            }
          }),
      );
  }

  onClose(): void {
    this.containerEl.removeClass('omnifocus-add-task-modal');
    const { contentEl } = this;
    contentEl.empty();
  }
}
