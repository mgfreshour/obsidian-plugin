/**
 * GUS (Salesforce work tracking) Obsidian integration.
 *
 * Registers the gus code block processor for displaying work items.
 */

import { html, render } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { App, Notice, requestUrl } from 'obsidian';
import {
  getAuthenticatedClient,
  loginViaBrowser,
  queryWorkItems,
  searchEpics,
} from './gus';
import type { CachedToken, RequestFn, TokenStorage } from './gus';
import { CreateUserStoryModal } from './create-user-story-modal';
import { CreatePlanModal } from './create-plan-modal';
import { isLLMConfigured, type LLMPluginContext } from './llm';
import type { LLMConfig } from './llm';

const GUS_WORK_LOCATOR_URL =
  'https://gus.my.salesforce.com/apex/ADM_WorkLocator?bugorworknumber=';

/** Lifecycle order: lower = earlier. Used for sorting work items. */
const STATUS_ORDER: Record<string, number> = {
  New: 0,
  Acknowledged: 0,
  Triaged: 0,
  'In Progress': 1,
  Integrate: 1,
  'Pending Release': 1,
  'QA In Progress': 1,
  Waiting: 2,
  Investigating: 2,
  'More Info Reqd from Support': 2,
  'Ready for Review': 3,
  Closed: 4,
  Fixed: 4,
  Duplicate: 4,
  Completed: 4,
  Rejected: 4,
  Never: 4,
  Inactive: 4,
  'Not a bug': 4,
  'Not Reproducible': 4,
  Deferred: 4,
};

function statusSortOrder(status: string): number {
  const s = status.trim();
  if (s in STATUS_ORDER) return STATUS_ORDER[s];
  if (s.startsWith('Waiting')) return 2;
  if (s.startsWith('Closed')) return 4;
  return 5; // unknown statuses last
}

/** Map GUS status to modifier class for styling. */
function gusStatusModifier(status: string): string {
  const s = status.trim();
  if (s.startsWith('Closed') || s === 'Fixed' || s === 'Duplicate') {
    return 'gus-status--closed';
  }
  if (
    ['New', 'Acknowledged', 'Triaged', 'In Progress', 'Integrate', 'Pending Release', 'QA In Progress'].includes(s)
  ) {
    return 'gus-status--active';
  }
  if (
    s.startsWith('Waiting') ||
    s === 'Investigating' ||
    s === 'More Info Reqd from Support'
  ) {
    return 'gus-status--waiting';
  }
  if (s === 'Ready for Review') return 'gus-status--review';
  if (s === 'Completed') return 'gus-status--completed';
  if (
    [
      'Rejected',
      'Never',
      'Inactive',
      'Not a bug',
      'Not Reproducible',
      'Deferred',
    ].includes(s)
  ) {
    return 'gus-status--rejected';
  }
  return 'gus-status--default';
}

/** Wrap plain URLs in anchor tags; avoids doubling URLs inside href attributes. */
function autoLinkUrls(htmlStr: string): string {
  return htmlStr.replace(
    /(^|[\s>])(https?:\/\/[^\s<]+)/g,
    (_, before, url) =>
      `${before}<a href="${url}" target="_blank" rel="noopener" class="gus-link">${url}</a>`,
  );
}

/** Plugin context required for GUS integration. */
export interface GusPluginContext {
  app: App;
  settings: {
    llmProvider?: string;
    llmApiKey?: string;
    llmBaseUrl?: string;
    llmModel?: string;
    llmModelUserStory?: string;
  };
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
  registerMarkdownCodeBlockProcessor(
    language: string,
    processor: (source: string, el: HTMLElement) => void | Promise<void>,
  ): void;
}

type GusWorkItem = {
  name: string;
  subject: string;
  status: string;
  description?: string;
};

/**
 * Insert a new work item ID into the gus block markdown in the active file.
 */
async function insertWorkItemIntoBlock(
  app: App,
  blockSource: string,
  workItemName: string,
): Promise<boolean> {
  const file = app.workspace.getActiveFile();
  if (!file) return false;
  try {
    const content = await app.vault.read(file);
    const escapedBody =
      blockSource === ''
        ? '\\n?'
        : blockSource
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\n/g, '\\n') + '\\n';
    const pattern = new RegExp('```gus\\n' + escapedBody + '```', 'm');
    if (!pattern.test(content)) return false;
    const newBlockBody = blockSource.trimEnd()
      ? `${blockSource.trimEnd()}\n${workItemName}`
      : workItemName;
    const newContent = content.replace(
      new RegExp('```gus\\n' + escapedBody + '```', 'm'),
      `\`\`\`gus\n${newBlockBody}\n\`\`\``,
    );
    await app.vault.modify(file, newContent);
    return true;
  } catch {
    return false;
  }
}

/**
 * Replace the gus block body with epic: <epicName> so the block displays that epic's work items.
 */
async function updateBlockWithEpic(
  app: App,
  blockSource: string,
  epicName: string,
): Promise<boolean> {
  const file = app.workspace.getActiveFile();
  if (!file) return false;
  try {
    const content = await app.vault.read(file);
    const escapedBody =
      blockSource === ''
        ? '\\n?'
        : blockSource
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\n/g, '\\n') + '\\n';
    const pattern = new RegExp('```gus\\n' + escapedBody + '```', 'm');
    if (!pattern.test(content)) return false;
    const newBlockBody = `epic: ${epicName}`;
    const newContent = content.replace(
      new RegExp('```gus\\n' + escapedBody + '```', 'm'),
      `\`\`\`gus\n${newBlockBody}\n\`\`\``,
    );
    await app.vault.modify(file, newContent);
    return true;
  } catch {
    return false;
  }
}

/**
 * Register GUS integration: code block processor for work items.
 */
export function registerGusIntegration(plugin: GusPluginContext): void {
  plugin.registerMarkdownCodeBlockProcessor('gus', (source, el) => {
    const container = el.createDiv({ cls: 'gus-container' });
    const btnRow = container.createDiv({ cls: 'gus-btn-row' });
    const contentDiv = container.createDiv({ cls: 'gus-content' });
    const trimmedLines = source
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const workItemIds = trimmedLines;
    const firstLine = trimmedLines[0] ?? '';
    const epicMatch = /^epic:\s*(.*)$/i.exec(firstLine);
    const epicQuery = epicMatch ? epicMatch[1].trim() : '';
    const isEpicMode = epicMatch !== null && epicQuery !== '';

    const gusTokenStorage: TokenStorage = {
      get: () =>
        plugin.loadData().then(
          (d) => (d as { gusToken?: CachedToken })?.gusToken ?? null,
        ),
      set: (data) =>
        plugin.loadData().then((d) =>
          plugin.saveData({ ...(d ?? {}), gusToken: data }),
        ),
    };

    const getLLMConfig = (): LLMConfig => ({
      provider: (plugin.settings?.llmProvider ?? 'openrouter') as LLMConfig['provider'],
      apiKey: plugin.settings?.llmApiKey ?? '',
      baseUrl: plugin.settings?.llmBaseUrl?.trim() || undefined,
      model:
        plugin.settings?.llmModelUserStory?.trim() ||
        plugin.settings?.llmModel?.trim() ||
        undefined,
    });

    const llmCtx: LLMPluginContext = {
      getConfig: getLLMConfig,
      requestUrl: async (opts) => {
        const res = await requestUrl({
          url: opts.url,
          method: opts.method ?? 'GET',
          headers: opts.headers,
          body: opts.body,
          throw: false,
        });
        return {
          status: res.status,
          json: res.json,
        };
      },
    };

    const onCreatePlanClick = () => {
      if (!isLLMConfigured(getLLMConfig())) {
        new Notice('LLM is not configured. Add API key or base URL in plugin settings.');
        return;
      }
      if (!plugin.app.workspace.getActiveFile()) {
        new Notice('No active note. Open a note with your design document.');
        return;
      }
      const modal = new CreatePlanModal(plugin.app, {
        app: plugin.app,
        llmCtx,
        requestFn: gusRequestFn,
        tokenStorage: gusTokenStorage,
        openBrowser,
        onSuccess: async (firstEpicName) => {
          const updated = await updateBlockWithEpic(
            plugin.app,
            source,
            firstEpicName,
          );
          if (updated) {
            new Notice(`Updated block with epic: ${firstEpicName}`);
          } else {
            new Notice('Could not update block.');
          }
        },
      });
      modal.open();
    };

    const onCreateUserStoryClick = () => {
      if (!isLLMConfigured(getLLMConfig())) {
        new Notice('LLM is not configured. Add API key or base URL in plugin settings.');
        return;
      }
      const modal = new CreateUserStoryModal(plugin.app, {
        app: plugin.app,
        llmCtx,
        requestFn: gusRequestFn,
        tokenStorage: gusTokenStorage,
        openBrowser,
        onSuccess: async (workItemName) => {
          const inserted = await insertWorkItemIntoBlock(
            plugin.app,
            source,
            workItemName,
          );
          if (inserted) {
            new Notice(`Added ${workItemName} to block.`);
          }
        },
      });
      modal.open();
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

    const createBtn = btnRow.createEl('button', {
      cls: 'gus-create-btn',
      text: 'Create User Story',
    });
    createBtn.addEventListener('click', onCreateUserStoryClick);

    const createPlanBtn = btnRow.createEl('button', {
      cls: 'gus-create-plan-btn',
      text: 'Create Plan',
    });
    createPlanBtn.addEventListener('click', onCreatePlanClick);

    const onDescriptionToggle = (e: Event) => {
      e.stopPropagation();
      const target = e.target as HTMLElement;
      const workItem = target.closest('.gus-work-item');
      const descEl = workItem?.querySelector<HTMLElement>('.gus-description');
      if (descEl) {
        const isOpen = descEl.style.display === 'none';
        descEl.style.display = isOpen ? 'block' : 'none';
        target.textContent = isOpen ? '[-]' : '[+]';
      }
    };

    const onLinkClick = (itemName: string) => (e: Event) => {
      e.preventDefault();
      const url = `${GUS_WORK_LOCATOR_URL}${encodeURIComponent(itemName)}`;
      openBrowser(url);
    };

    const renderView = (
      view:
        | { type: 'loading' }
        | { type: 'error'; message: string }
        | { type: 'login' }
        | { type: 'workItems'; items: GusWorkItem[]; missing: string[] },
    ) => {
      if (view.type === 'loading') {
        render(
          html`<div class="gus-loading">Loading work items...</div>`,
          contentDiv,
        );
        return;
      }
      if (view.type === 'error') {
        render(
          html`<p class="gus-error">${view.message}</p>`,
          contentDiv,
        );
        return;
      }
      if (view.type === 'login') {
        const onLoginClick = async () => {
          renderView({ type: 'loading' });
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
            renderView({ type: 'error', message });
          }
        };
        render(
          html`
            <p class="gus-login-prompt">Login to GUS to view work items.</p>
            <button class="gus-login-btn" @click=${onLoginClick}>
              Login to GUS
            </button>
          `,
          contentDiv,
        );
        return;
      }
      // view.type === 'workItems'
      const { items, missing } = view;
        render(
          html`
          ${missing.length > 0
            ? html`<p class="gus-error">Work items not found: ${missing.join(', ')}</p>`
            : ''}
          ${items.map(
            (item) => html`
              <div class="gus-work-item">
                <span class="gus-status ${gusStatusModifier(item.status)}"
                  >${item.status}</span
                >
                <div class="gus-header">
                  <span class="gus-title">${item.name}: ${item.subject}
                  ${item.description
                    ? html`<span
                        class="gus-description-toggle"
                        @click=${onDescriptionToggle}
                        >[+]</span
                      >`
                    : ''}
                  <a
                    class="gus-external-link"
                    href="${GUS_WORK_LOCATOR_URL}${encodeURIComponent(item.name)}"
                    title="Open in GUS"
                    @click=${onLinkClick(item.name)}
                    >↗</a
                  >
                    </span>
                </div>
                ${item.description
                  ? html`<div class="gus-description" style="display:none">
                      ${unsafeHTML(autoLinkUrls(item.description))}
                    </div>`
                  : ''}
              </div>
            `,
          )}
        `,
        contentDiv,
      );
    };

    const showUsage =
      workItemIds.length === 0 || (epicMatch !== null && epicQuery === '');
    if (showUsage) {
      render(
        html`<p class="gus-usage">Enter work item IDs (one per line, e.g. W-12345) or epic: &lt;name&gt; to show all tickets in an epic.</p>`,
        contentDiv,
      );
      return;
    }

    const doFetch = async () => {
      renderView({ type: 'loading' });
      const cached = await gusTokenStorage.get();
      const maxAgeMs = 8 * 60 * 60 * 1000;
      const isValid =
        cached &&
        Date.now() - new Date(cached.timeCollected).getTime() < maxAgeMs;

      if (!isValid) {
        renderView({ type: 'login' });
        return;
      }

      try {
        const { accessToken, instanceUrl } = await getAuthenticatedClient({
          tokenStorage: gusTokenStorage,
          openBrowser,
          requestFn: gusRequestFn,
        });

        if (isEpicMode) {
          const epics = await searchEpics(
            accessToken,
            instanceUrl,
            epicQuery,
            gusRequestFn,
            false, // search all epics, not just user's teams
          );
          if (epics.length === 0) {
            renderView({
              type: 'error',
              message: `No epics found for: ${epicQuery}`,
            });
            return;
          }
          if (epics.length > 1) {
            renderView({
              type: 'error',
              message: `Multiple epics found (be more specific): ${epics.map((e) => e.Name).join(', ')}`,
            });
            return;
          }
          const epicId = epics[0].Id.replace(/'/g, "''");
          const soql = `SELECT Id, Name, Subject__c, Status__c, Details__c FROM ADM_Work__c WHERE Epic__c = '${epicId}'`;
          const items = await queryWorkItems(
            accessToken,
            instanceUrl,
            soql,
            gusRequestFn,
          );
          items.sort((a, b) => {
            const orderA = statusSortOrder(a.status);
            const orderB = statusSortOrder(b.status);
            if (orderA !== orderB) return orderA - orderB;
            return a.name.localeCompare(b.name);
          });
          renderView({
            type: 'workItems',
            items,
            missing: [],
          });
          return;
        }

        const escapedIds = workItemIds.map((id) => id.replace(/'/g, "''"));
        const inList = "'" + escapedIds.join("','") + "'";
        const soql = `SELECT Id, Name, Subject__c, Status__c, Details__c FROM ADM_Work__c WHERE Name IN (${inList})`;
        const items = await queryWorkItems(
          accessToken,
          instanceUrl,
          soql,
          gusRequestFn,
        );
        items.sort((a, b) => {
          const orderA = statusSortOrder(a.status);
          const orderB = statusSortOrder(b.status);
          if (orderA !== orderB) return orderA - orderB;
          const ia = workItemIds.indexOf(a.name);
          const ib = workItemIds.indexOf(b.name);
          return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        });
        if (items.length === 0) {
          renderView({
            type: 'error',
            message: `Work items not found: ${workItemIds.join(', ')}`,
          });
        } else {
          const missing = workItemIds.filter(
            (id) => !items.some((it) => it.name === id),
          );
          renderView({
            type: 'workItems',
            items,
            missing,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        renderView({ type: 'error', message });
        console.error('GUS fetch failed:', err);
      }
    };

    doFetch();
  });
}
