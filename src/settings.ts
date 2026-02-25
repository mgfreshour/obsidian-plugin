/**
 * Settings module for the Obsidian Plugin.
 *
 * - `PluginSettings` defines the shape of persisted settings.
 * - `DEFAULT_SETTINGS` provides fallback values for missing or new fields.
 * - `SettingsTab` renders the settings UI and writes changes back via
 *   `plugin.saveSettings()`.
 *
 * Settings are persisted to `data.json` in the plugin directory via
 * Obsidian's `loadData()` / `saveData()`.
 */

import { App, Notice, PluginSettingTab, requestUrl, Setting } from 'obsidian';
import type ObsidianPlugin from '../main';
import {
  fetchModels,
  isLLMConfigured,
  type LLMConfig,
  type LLMProvider,
} from './llm';

export interface PluginSettings {
  textValue: string;
  syncIntervalMinutes: number;
  llmProvider: LLMProvider;
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  llmModelUserStory: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  textValue: '',
  syncIntervalMinutes: 5,
  llmProvider: 'openrouter',
  llmApiKey: '',
  llmBaseUrl: '',
  llmModel: '',
  llmModelUserStory: '',
};

export class SettingsTab extends PluginSettingTab {
  plugin: ObsidianPlugin;

  constructor(app: App, plugin: ObsidianPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'OmniFocus Sync' });

    new Setting(containerEl)
      .setName('Sync interval (minutes)')
      .setDesc('How often to auto-sync the OmniFocus inbox. Set to 0 to disable.')
      .addText((text) =>
        text
          .setPlaceholder('5')
          .setValue(String(this.plugin.settings.syncIntervalMinutes))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            this.plugin.settings.syncIntervalMinutes = isNaN(parsed) ? 0 : Math.max(0, parsed);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Text value')
      .setDesc('Enter a value to store.')
      .addText((text) =>
        text
          .setPlaceholder('Type something...')
          .setValue(this.plugin.settings.textValue)
          .onChange(async (value) => {
            this.plugin.settings.textValue = value;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl('h2', { text: 'LLM (AI)' });

    const providerOptions: Record<LLMProvider, string> = {
      openrouter: 'OpenRouter',
      openai: 'OpenAI',
      ollama: 'Ollama',
      custom: 'Custom',
    };

    new Setting(containerEl)
      .setName('Provider')
      .setDesc('LLM provider for AI features (e.g. GUS User Story and Bug creation).')
      .addDropdown((d) => {
        for (const [k, v] of Object.entries(providerOptions)) {
          d.addOption(k, v);
        }
        d.setValue(this.plugin.settings.llmProvider);
        d.onChange(async (value) => {
          this.plugin.settings.llmProvider = value as LLMProvider;
          await this.plugin.saveSettings();
          updateLLMVisibility();
        });
      });

    const apiKeySetting = new Setting(containerEl)
      .setName('API key')
      .setDesc('Required for OpenRouter and OpenAI. Not needed for Ollama.')
      .addText((text) => {
        text
          .setPlaceholder('sk-...')
          .setValue(this.plugin.settings.llmApiKey)
          .onChange(async (value) => {
            this.plugin.settings.llmApiKey = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = 'password';
      });

    const baseUrlSetting = new Setting(containerEl)
      .setName('Base URL')
      .setDesc('For Ollama: leave default or set custom (e.g. http://localhost:11434/v1). For Custom: required.')
      .addText((text) =>
        text
          .setPlaceholder('http://localhost:11434/v1')
          .setValue(this.plugin.settings.llmBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.llmBaseUrl = value;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl('h3', { text: 'User Story & Bug creation' });

    const datalistId = 'llm-models-userstory';
    const datalistEl = containerEl.createEl('datalist', { attr: { id: datalistId } });

    new Setting(containerEl)
      .setName('Model')
      .setDesc('Model for generating User Story and Bug titles and descriptions. Click Load models to fetch from provider.')
      .addText((text) => {
        text
          .setPlaceholder('e.g. gpt-4o, llama3.2')
          .setValue(this.plugin.settings.llmModelUserStory)
          .onChange(async (value) => {
            this.plugin.settings.llmModelUserStory = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.setAttribute('list', datalistId);
      })
      .addButton((btn) =>
        btn.setButtonText('Load models').onClick(async () => {
          const config: LLMConfig = {
            provider: (this.plugin.settings.llmProvider ?? 'openrouter') as LLMProvider,
            apiKey: this.plugin.settings.llmApiKey ?? '',
            baseUrl: this.plugin.settings.llmBaseUrl?.trim() || undefined,
          };
          if (!isLLMConfigured(config)) {
            new Notice('LLM is not configured. Set API key or base URL first.');
            return;
          }
          btn.setDisabled(true);
          btn.setButtonText('Loading...');
          const requestAdapter = async (opts: {
            url: string;
            method?: string;
            headers?: Record<string, string>;
            throw?: boolean;
          }) => {
            const res = await requestUrl({
              url: opts.url,
              method: opts.method ?? 'GET',
              headers: opts.headers,
              throw: opts.throw ?? false,
            });
            return { status: res.status, json: res.json };
          };
          const models = await fetchModels(requestAdapter, config);
          btn.setDisabled(false);
          btn.setButtonText('Load models');
          if (models.length === 0) {
            new Notice('Could not load models. Check provider and credentials.');
            return;
          }
          datalistEl.replaceChildren();
          for (const id of models) {
            const opt = datalistEl.createEl('option', { attr: { value: id } });
            opt.textContent = id;
          }
          new Notice(`Loaded ${models.length} models.`);
        }),
      );

    const updateLLMVisibility = (): void => {
      const p = this.plugin.settings.llmProvider;
      const needsApiKey = p === 'openrouter' || p === 'openai' || p === 'custom';
      const needsBaseUrl = p === 'ollama' || p === 'custom';
      apiKeySetting.settingEl.style.display = needsApiKey ? '' : 'none';
      baseUrlSetting.settingEl.style.display = needsBaseUrl ? '' : 'none';
      if (p === 'custom') {
        apiKeySetting.setDesc('Optional for some endpoints.');
        baseUrlSetting.setDesc('Required. Base URL including /v1 (e.g. https://api.example.com/v1).');
      } else if (p === 'ollama') {
        baseUrlSetting.setDesc('Leave default or set custom (e.g. http://localhost:11434/v1).');
      } else {
        apiKeySetting.setDesc(p === 'openrouter' ? 'From openrouter.ai' : 'From platform.openai.com');
      }
    };
    updateLLMVisibility();
  }
}
