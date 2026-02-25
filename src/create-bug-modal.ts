/**
 * Modal for creating a GUS Bug with AI-generated content via LLM.
 * Uses lit-html for all UI rendering.
 */

import { App, Modal, Notice, TFile } from 'obsidian';
import { html, render } from 'lit';
import { simpleChat } from './llm';
import type { LLMPluginContext } from './llm';
import {
  convertTextToHtml,
  createWorkItem,
  getAuthenticatedClient,
  getRecordTypeIds,
  searchEpics,
  searchProductTags,
} from './gus';
import type {
  CreateWorkItemPayload,
  EpicSearchResult,
  ProductTagSearchResult,
  RequestFn,
  TokenStorage,
} from './gus';

const BUG_SYSTEM_PROMPT = `You are helping to create a GUS bug report (similar to a Jira bug ticket).

Based on the user's summary and any additional context, generate a well-structured bug report.

GUIDELINES:
- Be professional and concise. Focus on reproduction steps and expected vs actual behavior.
- The title should be descriptive but no more than 80 characters.
- The description MUST include these sections:
  - ## Overview (brief summary of the issue)
  - ## Steps to Reproduce (numbered steps)
  - ## Expected vs Actual (what should happen vs what actually happens)
  - ## Environment (optional: OS, browser, version, etc. if relevant)
- Use standard bullet points (- item) for lists. DO NOT use checkboxes.

Recommend a severity. Valid values: Crash, Bug - no workaround, Bug - workaround, Annoying, Cosmetic, Major Feature, Minor Feature, Trivial.

IMPORTANT: You MUST output your final answer wrapped in tags like this:
<workItem>
{"title": "<TITLE>", "description": "<DESCRIPTION>", "severity": "<SEVERITY>"}
</workItem>

Output only the <workItem>...</workItem> block as your final answer.`;

const SEVERITY_OPTIONS = [
  'Crash',
  'Bug - no workaround',
  'Bug - workaround',
  'Annoying',
  'Cosmetic',
  'Major Feature',
  'Minor Feature',
  'Trivial',
] as const;

type Step = 1 | 2;

interface BugPreview {
  title: string;
  description: string;
  severity: string | null;
}

export interface CreateBugModalOptions {
  app: App;
  llmCtx: LLMPluginContext;
  requestFn: RequestFn;
  tokenStorage: TokenStorage;
  openBrowser: (url: string) => void;
  onSuccess: (workItemName: string) => void | Promise<void>;
  blockSource?: string;
}

export class CreateBugModal extends Modal {
  private readonly opts: CreateBugModalOptions;
  private step: Step = 1;
  private summary = '';
  private includeNoteContext = true;
  private preview: BugPreview | null = null;
  private generating = false;
  private productTagSearch = '';
  private productTagResults: ProductTagSearchResult[] = [];
  private selectedProductTag: ProductTagSearchResult | null = null;
  private searchingProductTags = false;
  private epicSearch = '';
  private epicResults: EpicSearchResult[] = [];
  private selectedEpic: EpicSearchResult | null = null;
  private searchingEpics = false;
  private severity: string | null = null;
  private creating = false;

  constructor(app: App, opts: CreateBugModalOptions) {
    super(app);
    this.opts = opts;
  }

  onOpen(): void {
    this.containerEl.addClass('gus-create-bug-modal');
    this.containerEl.addClass('gus-create-user-story-modal'); // reuse modal sizing styles
    this.render();
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
    const onSummaryInput = (e: Event) => {
      this.summary = (e.target as HTMLTextAreaElement).value;
    };
    const onToggleChange = (e: Event) => {
      this.includeNoteContext = (e.target as HTMLInputElement).checked;
      this.render();
    };
    const onGenerate = () => {
      this.summary = (
        this.contentEl.querySelector('.gus-create-summary') as HTMLTextAreaElement
      )?.value?.trim() ?? this.summary;
      if (!this.summary) {
        new Notice('Please enter a summary.');
        return;
      }
      this.doGenerate();
    };
    const onCancel = () => this.close();

    return html`
      <h2>Create Bug</h2>
      <p class="gus-create-desc">
        Enter a summary of the bug. The AI will generate a title, description, and severity.
      </p>

      <div class="setting-item">
        <div class="setting-item-name">Summary</div>
        <div class="setting-item-control">
          <textarea
            class="gus-create-summary"
            placeholder="e.g., Login fails when using SSO with expired session"
            rows="4"
            .value=${this.summary}
            @input=${onSummaryInput}
          ></textarea>
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-item-name">Include active note as context</div>
        <div class="setting-item-description">
          Use the current note content to help generate the bug report.
        </div>
        <div class="setting-item-control">
          <input
            type="checkbox"
            ?checked=${this.includeNoteContext}
            @change=${onToggleChange}
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
            ${this.generating ? 'Generating...' : 'Generate'}
          </button>
        </div>
      </div>
    `;
  }

  private async doGenerate(): Promise<void> {
    this.generating = true;
    this.render();

    let context = '';
    if (this.includeNoteContext) {
      const file = this.app.workspace.getActiveFile();
      if (file instanceof TFile) {
        try {
          const content = await this.app.vault.cachedRead(file);
          context = `\n\nAdditional context from active note "${file.name}":\n${content.slice(0, 2000)}`;
        } catch {
          // ignore
        }
      }
    }

    const userMessage = `USER'S SUMMARY:\n${this.summary}${context}`;

    try {
      const response = await simpleChat(this.opts.llmCtx, userMessage, {
        systemPrompt: BUG_SYSTEM_PROMPT,
        max_tokens: 2000,
      });

      const parsed = this.parseBugResponse(response);
      if (parsed) {
        this.preview = parsed;
        this.severity = parsed.severity;
        this.step = 2;
      } else {
        new Notice('Could not parse bug from AI response. Try again.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`AI error: ${msg}`);
    }
    this.generating = false;
    this.render();
  }

  private parseBugResponse(text: string): BugPreview | null {
    const match = text.match(/<workItem>\s*([\s\S]*?)<\/workItem>/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[1].trim()) as {
        title?: string;
        description?: string;
        severity?: string;
      };
      const title = String(parsed.title ?? 'Untitled').slice(0, 255);
      const description = String(parsed.description ?? '');
      const sev = parsed.severity;
      const severity =
        sev && (SEVERITY_OPTIONS as readonly string[]).includes(sev)
          ? sev
          : null;
      return { title, description, severity };
    } catch {
      return null;
    }
  }

  private renderStep2() {
    const p = this.preview!;

    const onTitleInput = (e: Event) => {
      p.title = (e.target as HTMLInputElement).value;
    };
    const onDescInput = (e: Event) => {
      p.description = (e.target as HTMLTextAreaElement).value;
    };
    const onSeverityChange = (e: Event) => {
      const v = (e.target as HTMLSelectElement).value;
      this.severity = v || null;
      this.render();
    };
    const onProductTagSearchInput = (e: Event) => {
      this.productTagSearch = (e.target as HTMLInputElement).value;
    };
    const onProductTagChange = (e: Event) => {
      const v = (e.target as HTMLSelectElement).value;
      this.selectedProductTag =
        this.productTagResults.find((t) => t.Id === v) ?? null;
      this.render();
    };
    const onEpicSearchInput = (e: Event) => {
      this.epicSearch = (e.target as HTMLInputElement).value;
    };
    const onEpicChange = (e: Event) => {
      const v = (e.target as HTMLSelectElement).value;
      this.selectedEpic =
        this.epicResults.find((epic) => epic.Id === v) ?? null;
      this.render();
    };
    const onBack = () => {
      this.step = 1;
      this.render();
    };
    const onCreate = async () => {
      const titleEl = this.contentEl.querySelector(
        '.gus-create-title',
      ) as HTMLInputElement;
      const descEl = this.contentEl.querySelector(
        '.gus-create-description',
      ) as HTMLTextAreaElement;
      if (titleEl) p.title = titleEl.value;
      if (descEl) p.description = descEl.value;
      if (!this.selectedProductTag) {
        new Notice('Product Tag is required.');
        return;
      }
      await this.doCreate(p);
    };

    return html`
      <h2>Review & Configure</h2>

      <div class="setting-item">
        <div class="setting-item-name">Title</div>
        <div class="setting-item-control">
          <input
            type="text"
            class="gus-create-title"
            .value=${p.title}
            @input=${onTitleInput}
          />
        </div>
      </div>

      <div class="setting-item setting-item-description">
        <div class="setting-item-name">Description</div>
        <div class="setting-item-control">
          <textarea
            class="gus-create-description"
            rows="16"
            .value=${p.description}
            @input=${onDescInput}
          ></textarea>
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-item-name">Severity</div>
        <div class="setting-item-control">
          <select @change=${onSeverityChange}>
            <option value="">--</option>
            ${SEVERITY_OPTIONS.map(
              (s) =>
                html`<option value=${s} ?selected=${this.severity === s}>${s}</option>`,
            )}
          </select>
        </div>
      </div>

      <h3>Product Tag (required)</h3>
      <div class="setting-item">
        <div class="setting-item-name">Search product tags</div>
        <div class="setting-item-control" style="display: flex; gap: 8px;">
          <input
            type="text"
            class="gus-create-product-tag-search"
            placeholder="Type to search..."
            .value=${this.productTagSearch}
            @input=${onProductTagSearchInput}
          />
          <button @click=${() => this.searchProductTags()}>Search</button>
        </div>
        ${this.searchingProductTags
          ? html`<div class="setting-item-description">Searching...</div>`
          : ''}
      </div>

      ${this.productTagResults.length > 0
        ? html`
            <div class="setting-item">
              <div class="setting-item-name">Select a product tag</div>
              <div class="setting-item-control">
                <select @change=${onProductTagChange}>
                  <option value="">Select a product tag...</option>
                  ${this.productTagResults.map(
                    (t) =>
                      html`<option
                        value=${t.Id}
                        ?selected=${this.selectedProductTag?.Id === t.Id}
                      >
                        ${t.Name}
                      </option>`,
                  )}
                </select>
              </div>
            </div>
          `
        : ''}

      ${this.selectedProductTag
        ? html`<p class="gus-create-selected">
            Selected: ${this.selectedProductTag.Name}
          </p>`
        : ''}

      <h3>Epic (optional)</h3>
      <div class="setting-item">
        <div class="setting-item-name">Search epics</div>
        <div class="setting-item-control" style="display: flex; gap: 8px;">
          <input
            type="text"
            class="gus-create-epic-search"
            placeholder="Type to search..."
            .value=${this.epicSearch}
            @input=${onEpicSearchInput}
          />
          <button @click=${() => this.searchEpics()}>Search</button>
        </div>
      </div>

      ${this.searchingEpics
        ? html`<p>Searching...</p>`
        : this.epicResults.length > 0
          ? html`
              <div class="setting-item">
                <div class="setting-item-name">Select epic</div>
                <div class="setting-item-control">
                  <select @change=${onEpicChange}>
                    <option value="">None</option>
                    ${this.epicResults.map(
                      (e) =>
                        html`<option
                          value=${e.Id}
                          ?selected=${this.selectedEpic?.Id === e.Id}
                        >
                          ${e.Name}
                        </option>`,
                    )}
                  </select>
                </div>
              </div>
            `
          : ''}

      <div class="setting-item">
        <div class="setting-item-control" style="display: flex; gap: 8px;">
          <button ?disabled=${this.creating} @click=${onBack}>Back</button>
          <button
            class="mod-cta"
            ?disabled=${this.creating}
            @click=${onCreate}
          >
            ${this.creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    `;
  }

  private async searchProductTags(): Promise<void> {
    this.productTagSearch = (
      this.contentEl.querySelector(
        '.gus-create-product-tag-search',
      ) as HTMLInputElement
    )?.value ?? this.productTagSearch;
    this.searchingProductTags = true;
    this.render();
    try {
      const { accessToken, instanceUrl } = await this.getGusAuth();
      this.productTagResults = await searchProductTags(
        accessToken,
        instanceUrl,
        this.productTagSearch.trim(),
        this.opts.requestFn,
      );
    } catch (err) {
      this.productTagResults = [];
      new Notice(
        err instanceof Error ? err.message : 'Product tag search failed',
      );
    }
    this.searchingProductTags = false;
    this.render();
  }

  private async searchEpics(): Promise<void> {
    this.epicSearch = (
      this.contentEl.querySelector(
        '.gus-create-epic-search',
      ) as HTMLInputElement
    )?.value ?? this.epicSearch;
    this.searchingEpics = true;
    this.render();
    try {
      const { accessToken, instanceUrl } = await this.getGusAuth();
      this.epicResults = await searchEpics(
        accessToken,
        instanceUrl,
        this.epicSearch.trim(),
        this.opts.requestFn,
      );
    } catch (err) {
      this.epicResults = [];
      new Notice(err instanceof Error ? err.message : 'Epic search failed');
    }
    this.searchingEpics = false;
    this.render();
  }

  private async getGusAuth(): Promise<{ accessToken: string; instanceUrl: string }> {
    return getAuthenticatedClient({
      tokenStorage: this.opts.tokenStorage,
      openBrowser: this.opts.openBrowser,
      requestFn: this.opts.requestFn,
    });
  }

  private async doCreate(p: BugPreview): Promise<void> {
    this.creating = true;
    this.render();

    try {
      const { accessToken, instanceUrl } = await this.getGusAuth();
      const recordTypeMap = await getRecordTypeIds(
        accessToken,
        instanceUrl,
        this.opts.requestFn,
      );
      const recordTypeId = recordTypeMap['Bug'];
      if (!recordTypeId) {
        throw new Error('Could not get Bug record type');
      }

      const payload: CreateWorkItemPayload = {
        Subject__c: p.title.slice(0, 255),
        Details__c: convertTextToHtml(p.description),
        Product_Tag__c: this.selectedProductTag!.Id,
        RecordTypeId: recordTypeId,
        Type__c: 'Bug',
        ...(this.selectedEpic && { Epic__c: this.selectedEpic.Id }),
        ...(this.severity && { Severity__c: this.severity }),
      };

      const result = await createWorkItem(
        accessToken,
        instanceUrl,
        payload,
        this.opts.requestFn,
      );

      new Notice(`Created ${result.name}`);
      this.opts.openBrowser(result.url);
      this.opts.onSuccess(result.name);
      this.close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Create failed: ${msg}`);
    }
    this.creating = false;
    this.render();
  }

  onClose(): void {
    this.containerEl.removeClass('gus-create-bug-modal');
    this.containerEl.removeClass('gus-create-user-story-modal');
    this.contentEl.empty();
  }
}
