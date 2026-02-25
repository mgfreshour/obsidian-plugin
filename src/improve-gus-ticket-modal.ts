/**
 * Modal for improving an existing GUS ticket with AI-generated suggestions.
 * Fetches the ticket and its comments, passes them to the LLM, and displays suggestions.
 * Uses lit-html for all UI rendering.
 */

import { App, Modal, Notice } from 'obsidian';
import { html, render } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { simpleChat } from './llm';
import type { LLMPluginContext } from './llm';
import {
  fetchCommentsForWorkItem,
  fetchWorkItemByName,
  getAuthenticatedClient,
  htmlToText,
} from './gus';
import type { GusComment, GusWorkItem, RequestFn, TokenStorage } from './gus';

const IMPROVE_TICKET_SYSTEM_PROMPT = `You are helping improve an existing GUS work ticket. Given the ticket details and comments, suggest concrete improvements.

GUIDELINES:
- Focus on clarity, completeness, and actionable next steps
- Consider missing information (steps to reproduce, acceptance criteria, etc.)
- Suggest phrasing improvements if the description is unclear
- Be concise; bullet points are fine

Output your suggestions as HTML. Use only these tags: <p>, <ul>, <ol>, <li>, <strong>, <em>, <h3>, <h4>, <br>. Wrap each section in <p> or use <ul>/<li> for lists. Do not modify the ticket in GUS; these are recommendations only.`;

type Step = 1 | 2;

export interface ImproveGusTicketModalOptions {
  app: App;
  llmCtx: LLMPluginContext;
  requestFn: RequestFn;
  tokenStorage: TokenStorage;
  openBrowser: (url: string) => void;
  onSuccess?: (ticketName: string) => void | Promise<void>;
  /** When set, pre-fills the ticket name and auto-starts the improve flow. */
  initialTicketName?: string;
}

export class ImproveGusTicketModal extends Modal {
  private readonly opts: ImproveGusTicketModalOptions;
  private step: Step = 1;
  private ticketName = '';
  private generating = false;
  private suggestions = '';

  constructor(app: App, opts: ImproveGusTicketModalOptions) {
    super(app);
    this.opts = opts;
    if (opts.initialTicketName?.trim()) {
      this.ticketName = opts.initialTicketName.trim();
    }
  }

  onOpen(): void {
    this.containerEl.addClass('gus-improve-ticket-modal');
    this.containerEl.addClass('gus-create-user-story-modal');
    this.render();
    if (this.ticketName) {
      queueMicrotask(() => this.doGenerate());
    }
  }

  private render(): void {
    const { contentEl } = this;
    if (!contentEl?.isConnected) return;

    contentEl.empty();
    const mount = contentEl.createDiv();
    if (this.step === 1) {
      render(this.renderStep1(), mount);
    } else {
      render(this.renderStep2(), mount);
    }
  }

  private renderStep1() {
    const onTicketInput = (e: Event) => {
      this.ticketName = (e.target as HTMLInputElement).value;
    };
    const onGenerate = () => {
      this.ticketName = (
        this.contentEl.querySelector('.gus-improve-ticket-name') as HTMLInputElement
      )?.value?.trim() ?? this.ticketName;
      if (!this.ticketName) {
        new Notice('Please enter a ticket name (e.g. W-12345).');
        return;
      }
      this.doGenerate();
    };
    const onCancel = () => this.close();

    return html`
      <h2>Improve GUS Ticket</h2>
      <p class="gus-create-desc">
        Enter an existing ticket name. The AI will fetch the ticket and comments, then suggest improvements.
      </p>

      <div class="setting-item">
        <div class="setting-item-name">Ticket name</div>
        <div class="setting-item-control">
          <input
            type="text"
            class="gus-improve-ticket-name"
            placeholder="e.g. W-12345"
            .value=${this.ticketName}
            @input=${onTicketInput}
          />
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-item-control" style="display: flex; gap: 8px;">
          <button ?disabled=${this.generating} @click=${onCancel}>
            Cancel
          </button>
          <button
            class="mod-cta"
            ?disabled=${this.generating}
            @click=${onGenerate}
          >
            ${this.generating ? 'Fetching & Analyzing...' : 'Get Suggestions'}
          </button>
        </div>
      </div>
    `;
  }

  private async doGenerate(): Promise<void> {
    this.generating = true;
    this.render();

    try {
      const { accessToken, instanceUrl } = await getAuthenticatedClient({
        tokenStorage: this.opts.tokenStorage,
        openBrowser: this.opts.openBrowser,
        requestFn: this.opts.requestFn,
      });

      const workItem = await fetchWorkItemByName(
        accessToken,
        instanceUrl,
        this.ticketName,
        this.opts.requestFn,
      );

      if (!workItem) {
        new Notice(`Ticket not found: ${this.ticketName}`);
        this.generating = false;
        this.render();
        return;
      }

      const comments = await fetchCommentsForWorkItem(
        accessToken,
        instanceUrl,
        workItem.id,
        this.opts.requestFn,
      );

      const userMessage = this.buildUserMessage(workItem, comments);
      const response = await simpleChat(this.opts.llmCtx, userMessage, {
        systemPrompt: IMPROVE_TICKET_SYSTEM_PROMPT,
        max_tokens: 2000,
      });

      this.suggestions = response;
      this.step = 2;
      this.opts.onSuccess?.(workItem.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Error: ${msg}`);
    }

    this.generating = false;
    this.render();
  }

  private buildUserMessage(workItem: GusWorkItem, comments: GusComment[]): string {
    const descText = workItem.description
      ? htmlToText(workItem.description)
      : '(no description)';

    let out = `## Ticket: ${workItem.name}
**Subject:** ${workItem.subject}
**Status:** ${workItem.status}
${workItem.recordTypeDeveloperName ? `**Type:** ${workItem.recordTypeDeveloperName}\n` : ''}
${workItem.severity ? `**Severity:** ${workItem.severity}\n` : ''}
${workItem.productTagName ? `**Product Tag:** ${workItem.productTagName}\n` : ''}
${workItem.epicName ? `**Epic:** ${workItem.epicName}\n` : ''}

### Description
${descText}
`;

    if (comments.length > 0) {
      out += '\n### Comments\n';
      for (const c of comments) {
        const date = c.createdDate ? ` (${c.createdDate})` : '';
        const by = c.createdBy ? ` by ${c.createdBy}` : '';
        out += `\n---${date}${by}\n`;
        out += c.body ? htmlToText(c.body) : '(empty)';
        out += '\n';
      }
    }

    return out;
  }

  private renderStep2() {
    const onClose = () => this.close();

    return html`
      <h2>Improvement Suggestions for ${this.ticketName}</h2>

      <div class="setting-item setting-item-description">
        <div class="setting-item-name">Suggestions</div>
        <div class="setting-item-control">
          <div class="gus-improve-suggestions">${unsafeHTML(this.suggestions)}</div>
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-item-control" style="display: flex; gap: 8px;">
          <button class="mod-cta" @click=${onClose}>Close</button>
        </div>
      </div>
    `;
  }

  onClose(): void {
    this.containerEl.removeClass('gus-improve-ticket-modal');
    this.containerEl.removeClass('gus-create-user-story-modal');
    this.contentEl.empty();
  }
}
