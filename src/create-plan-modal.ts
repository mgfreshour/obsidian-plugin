/**
 * Modal for creating GUS epics and work items from a design document via LLM.
 * Uses lit-html for all UI rendering.
 */

import { App, Modal, Notice, TFile } from 'obsidian';
import { html, render } from 'lit';
import { simpleChat } from './llm';
import type { LLMPluginContext } from './llm';
import {
  convertTextToHtml,
  createEpic,
  createWorkItem,
  getAuthenticatedClient,
  getUserStoryRecordTypeId,
  searchProductTags,
} from './gus';
import type {
  CreateEpicPayload,
  CreateWorkItemPayload,
  ProductTagSearchResult,
  RequestFn,
  TokenStorage,
} from './gus';

const PLAN_SYSTEM_PROMPT = `You are helping to break down a design document into a structured plan with multiple epics and work items for GUS (similar to Jira).

DESIGN DOCUMENT:
{design_doc}

Based on the design document, analyze it and break it down into:
1. Multiple epics (high-level features or themes)
2. Work items within each epic (specific tasks or user stories)

GUIDELINES:
- Be professional and comprehensive. Break down the design into logical, implementable pieces.
- Epics should represent major features or themes that group related work items together.
- Work items should be specific, actionable tasks that can be completed independently.
- Each work item should have:
  - A clear, descriptive title (max 80 characters)
  - A detailed description from the perspective of someone creating the ticket before work starts (forward-looking tone)
  - Story points estimate (1, 2, 3, or 5)
- Use markdown headers for structure: '##' for main sections, '###' for subsections
- Use standard bullet points (- item) for lists. DO NOT use checkboxes (- [ ] item)
- If the design doc includes code snippets or links, include them in the relevant work items
- If the design doc references external documentation, include links in the work items

Story Point Reference:
- 1 = Trivial changes (minor fixes, simple updates, 1-2 files)
- 2 = Small changes (straightforward implementations, 2-5 files)
- 3 = Medium changes (moderate complexity, multiple files, some design needed)
- 5 = Large changes (complex features, many files, significant design/testing)

IMPORTANT: You MUST output your final answer wrapped in tags like this:
<plan>
{
  "epics": [
    {
      "name": "<EPIC_NAME>",
      "description": "<EPIC_DESCRIPTION>",
      "work_items": [
        {
          "title": "<WORK_ITEM_TITLE>",
          "description": "<WORK_ITEM_DESCRIPTION>",
          "story_points": <POINTS>
        }
      ]
    }
  ]
}
</plan>

You can think or plan before the tags, but make sure to wrap your final JSON response in the <plan></plan> tags.`;

type Step = 1 | 2;

interface PlanEpic {
  name: string;
  description?: string;
  work_items: Array<{
    title: string;
    description: string;
    story_points?: number;
  }>;
}

interface PlanData {
  epics: PlanEpic[];
}

export interface CreatePlanModalOptions {
  app: App;
  llmCtx: LLMPluginContext;
  requestFn: RequestFn;
  tokenStorage: TokenStorage;
  openBrowser: (url: string) => void;
  onSuccess: (firstEpicName: string) => void | Promise<void>;
  blockSource?: string;
}

export class CreatePlanModal extends Modal {
  private readonly opts: CreatePlanModalOptions;
  private step: Step = 1;
  private designDoc = '';
  private planData: PlanData | null = null;
  private generating = false;
  private productTagSearch = '';
  private productTagResults: ProductTagSearchResult[] = [];
  private selectedProductTag: ProductTagSearchResult | null = null;
  private searchingProductTags = false;
  private creating = false;

  constructor(app: App, opts: CreatePlanModalOptions) {
    super(app);
    this.opts = opts;
  }

  async onOpen(): Promise<void> {
    this.containerEl.addClass('gus-create-plan-modal');
    await this.loadActiveNote();
    this.render();
  }

  private async loadActiveNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (file instanceof TFile) {
      try {
        const content = await this.app.vault.cachedRead(file);
        this.designDoc = content ?? '';
      } catch {
        this.designDoc = '';
      }
    } else {
      this.designDoc = '';
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
    const onDesignDocInput = (e: Event) => {
      this.designDoc = (e.target as HTMLTextAreaElement).value;
      this.render();
    };
    const onGenerate = () => {
      this.designDoc = (
        this.contentEl.querySelector('.gus-plan-design-doc') as HTMLTextAreaElement
      )?.value?.trim() ?? this.designDoc;
      if (!this.designDoc) {
        new Notice('Please enter or load a design document.');
        return;
      }
      this.doGenerate();
    };
    const onCancel = () => this.close();

    const file = this.app.workspace.getActiveFile();
    const noteLabel =
      file instanceof TFile ? `Design document from: ${file.name}` : 'No active note';

    return html`
      <h2>Create Plan</h2>
      <p class="gus-create-desc">
        Generate epics and work items from your design document. Content is loaded from the active
        note—edit below if needed.
      </p>

      <div class="setting-item">
        <div class="setting-item-name">${noteLabel}</div>
        <div class="setting-item-control">
          <textarea
            class="gus-plan-design-doc"
            placeholder="Paste or edit your design document..."
            rows="12"
            .value=${this.designDoc}
            @input=${onDesignDocInput}
          ></textarea>
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-item-control" style="display: flex; gap: 8px;">
          <button ?disabled=${this.generating} @click=${onCancel}>
            Cancel
          </button>
          <button
            class="mod-cta"
            ?disabled=${this.generating || !this.designDoc.trim()}
            @click=${onGenerate}
          >
            ${this.generating ? 'Generating...' : 'Generate Plan'}
          </button>
        </div>
      </div>
    `;
  }

  private async doGenerate(): Promise<void> {
    this.designDoc = (
      this.contentEl.querySelector('.gus-plan-design-doc') as HTMLTextAreaElement
    )?.value?.trim() ?? this.designDoc;

    if (!this.designDoc) {
      new Notice('Design document is required.');
      return;
    }

    this.generating = true;
    this.render();

    const systemPrompt = PLAN_SYSTEM_PROMPT.replace('{design_doc}', this.designDoc);

    try {
      const response = await simpleChat(this.opts.llmCtx, 'Generate the plan based on the design document above.', {
        systemPrompt,
        max_tokens: 4000,
      });

      const parsed = this.parsePlanResponse(response);
      if (parsed) {
        this.planData = parsed;
        this.step = 2;
      } else {
        new Notice('Could not parse plan from AI response. Try again.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`AI error: ${msg}`);
    }
    this.generating = false;
    this.render();
  }

  private parsePlanResponse(text: string): PlanData | null {
    const match = text.match(/<plan>\s*([\s\S]*?)<\/plan>/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[1].trim()) as { epics?: unknown[] };
      if (!Array.isArray(parsed.epics) || parsed.epics.length === 0) return null;

      const epics: PlanEpic[] = [];
      for (const e of parsed.epics) {
        const epic = e as { name?: string; description?: string; work_items?: unknown[] };
        if (!epic.name || !Array.isArray(epic.work_items)) return null;
        const workItems = epic.work_items.map((wi: unknown) => {
          const w = wi as { title?: string; description?: string; story_points?: number };
          return {
            title: String(w.title ?? 'Untitled').slice(0, 255),
            description: String(w.description ?? ''),
            story_points:
              w.story_points != null && [1, 2, 3, 5].includes(w.story_points)
                ? w.story_points
                : undefined,
          };
        });
        epics.push({
          name: epic.name,
          description: epic.description,
          work_items: workItems,
        });
      }
      return { epics };
    } catch {
      return null;
    }
  }

  private renderStep2() {
    const plan = this.planData!;
    const totalWorkItems = plan.epics.reduce((n, e) => n + e.work_items.length, 0);

    const onProductTagSearchInput = (e: Event) => {
      this.productTagSearch = (e.target as HTMLInputElement).value;
    };
    const onProductTagChange = (e: Event) => {
      const v = (e.target as HTMLSelectElement).value;
      this.selectedProductTag =
        this.productTagResults.find((t) => t.Id === v) ?? null;
      this.render();
    };
    const onBack = () => {
      this.step = 1;
      this.render();
    };
    const onCreate = () => this.doCreate();

    return html`
      <h2>Preview & Create</h2>
      <p class="gus-create-desc">
        ${plan.epics.length} epic(s), ${totalWorkItems} work item(s)
      </p>

      <div class="gus-plan-preview">
        ${plan.epics.map(
          (epic, idx) => html`
            <div class="gus-plan-epic">
              <strong>Epic ${idx + 1}: ${epic.name}</strong>
              <ul>
                ${epic.work_items.map(
                  (wi) => html`
                    <li>
                      ${wi.title}
                      ${wi.story_points != null ? html`<span class="gus-plan-points">[${wi.story_points} pts]</span>` : ''}
                    </li>
                  `,
                )}
              </ul>
            </div>
          `,
        )}
      </div>

      <h3>Product Tag (required)</h3>
      <div class="setting-item">
        <div class="setting-item-name">Search product tags</div>
        <div class="setting-item-control" style="display: flex; gap: 8px;">
          <input
            type="text"
            class="gus-plan-product-tag-search"
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

      <div class="setting-item">
        <div class="setting-item-control" style="display: flex; gap: 8px;">
          <button ?disabled=${this.creating} @click=${onBack}>Back</button>
          <button
            class="mod-cta"
            ?disabled=${this.creating || !this.selectedProductTag}
            @click=${onCreate}
          >
            ${this.creating ? 'Creating...' : 'Create Plan'}
          </button>
        </div>
      </div>
    `;
  }

  private async searchProductTags(): Promise<void> {
    this.productTagSearch = (
      this.contentEl.querySelector(
        '.gus-plan-product-tag-search',
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

  private async getGusAuth(): Promise<{
    accessToken: string;
    instanceUrl: string;
  }> {
    return getAuthenticatedClient({
      tokenStorage: this.opts.tokenStorage,
      openBrowser: this.opts.openBrowser,
      requestFn: this.opts.requestFn,
    });
  }

  private async doCreate(): Promise<void> {
    if (!this.planData || !this.selectedProductTag) return;

    this.creating = true;
    this.render();

    try {
      const { accessToken, instanceUrl } = await this.getGusAuth();
      const recordTypeId = await getUserStoryRecordTypeId(
        accessToken,
        instanceUrl,
        this.opts.requestFn,
      );
      if (!recordTypeId) {
        throw new Error('Could not get User Story record type');
      }

      let firstEpicName = '';

      for (const epic of this.planData.epics) {
        const epicPayload: CreateEpicPayload = {
          Name: epic.name,
          ...(epic.description && {
            Description__c: convertTextToHtml(epic.description),
          }),
        };
        const epicResult = await createEpic(
          accessToken,
          instanceUrl,
          epicPayload,
          this.opts.requestFn,
        );

        if (!firstEpicName) {
          firstEpicName = epicResult.name;
          this.opts.openBrowser(epicResult.url);
        }

        for (const wi of epic.work_items) {
          const payload: CreateWorkItemPayload = {
            Subject__c: wi.title,
            Details__c: convertTextToHtml(wi.description),
            Product_Tag__c: this.selectedProductTag.Id,
            RecordTypeId: recordTypeId,
            Type__c: 'User Story',
            Epic__c: epicResult.id,
            ...(wi.story_points != null && {
              Story_Points__c: wi.story_points,
            }),
          };

          await createWorkItem(
            accessToken,
            instanceUrl,
            payload,
            this.opts.requestFn,
          );
        }
      }

      new Notice('Plan created successfully.');
      this.opts.onSuccess(firstEpicName);
      this.close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Create plan failed: ${msg}`);
    }
    this.creating = false;
    this.render();
  }

  onClose(): void {
    this.containerEl.removeClass('gus-create-plan-modal');
    this.contentEl.empty();
  }
}
