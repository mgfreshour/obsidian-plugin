/**
 * GUS (Salesforce work tracking) Obsidian integration.
 *
 * Registers the gus code block processor for displaying work items.
 */

import { Notice, requestUrl } from 'obsidian';
import {
  getAuthenticatedClient,
  loginViaBrowser,
  queryWorkItems,
} from './gus';
import type { CachedToken, RequestFn, TokenStorage } from './gus';

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
function autoLinkUrls(html: string): string {
  return html.replace(
    /(^|[\s>])(https?:\/\/[^\s<]+)/g,
    (_, before, url) =>
      `${before}<a href="${url}" target="_blank" rel="noopener" class="gus-link">${url}</a>`,
  );
}

/** Plugin context required for GUS integration. */
export interface GusPluginContext {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
  registerMarkdownCodeBlockProcessor(
    language: string,
    processor: (source: string, el: HTMLElement) => void | Promise<void>,
  ): void;
}

/**
 * Register GUS integration: code block processor for work items.
 */
export function registerGusIntegration(plugin: GusPluginContext): void {
  plugin.registerMarkdownCodeBlockProcessor('gus', (source, el) => {
    const container = el.createDiv({ cls: 'gus-container' });
    const workItemIds = source
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (workItemIds.length === 0) {
      container.createEl('p', {
        text: 'Enter work item IDs (one per line, e.g. W-12345)',
        cls: 'gus-usage',
      });
      return;
    }

    const gusTokenStorage: TokenStorage = {
      get: () => plugin.loadData().then((d) => (d as { gusToken?: CachedToken })?.gusToken ?? null),
      set: (data) =>
        plugin.loadData().then((d) =>
          plugin.saveData({ ...(d ?? {}), gusToken: data }),
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
      container.createDiv({
        cls: 'gus-loading',
        text: 'Loading work items...',
      });
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

    const GUS_WORK_LOCATOR_URL =
      'https://gus.my.salesforce.com/apex/ADM_WorkLocator?bugorworknumber=';

    const renderWorkItem = (
      parent: HTMLElement,
      item: {
        name: string;
        subject: string;
        status: string;
        description?: string;
      },
    ) => {
      const itemEl = parent.createDiv({ cls: 'gus-work-item' });
      itemEl.createEl('span', {
        text: item.status,
        cls: `gus-status ${gusStatusModifier(item.status)}`,
      });
      const header = itemEl.createDiv({ cls: 'gus-header' });
      header.createEl('span', {
        text: `${item.name}: ${item.subject}`,
        cls: 'gus-title',
      });
      if (item.description) {
        const toggle = header.createSpan({
          cls: 'gus-description-toggle',
          text: '[+]',
        });
        const descEl = itemEl.createDiv({ cls: 'gus-description' });
        descEl.innerHTML = autoLinkUrls(item.description);
        descEl.style.display = 'none';
        toggle.addEventListener('click', (e) => {
          e.stopPropagation();
          const isOpen = descEl.style.display === 'none';
          descEl.style.display = isOpen ? 'block' : 'none';
          toggle.setText(isOpen ? '[-]' : '[+]');
        });
      }
      const link = header.createEl('a', {
        href: `${GUS_WORK_LOCATOR_URL}${encodeURIComponent(item.name)}`,
        cls: 'gus-external-link',
        title: 'Open in GUS',
      });
      link.setText('↗');
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const url = `${GUS_WORK_LOCATOR_URL}${encodeURIComponent(item.name)}`;
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
      });
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
          const ia = workItemIds.indexOf(a.name);
          const ib = workItemIds.indexOf(b.name);
          return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        });
        if (items.length === 0) {
          renderError(
            `Work items not found: ${workItemIds.join(', ')}`,
          );
        } else {
          const missing = workItemIds.filter(
            (id) => !items.some((it) => it.name === id),
          );
          container.empty();
          if (missing.length > 0) {
            container.createEl('p', {
              text: `Work items not found: ${missing.join(', ')}`,
              cls: 'gus-error',
            });
          }
          for (const item of items) {
            renderWorkItem(container, item);
          }
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
