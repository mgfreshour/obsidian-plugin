/**
 * Generic LLM API utility module.
 *
 * Supports OpenRouter, OpenAI, local Ollama, and custom endpoints.
 * All use the OpenAI-compatible chat completions API.
 *
 * @see https://openrouter.ai/docs/api-reference/chat-completion
 * @see https://platform.openai.com/docs/api-reference/chat
 * @see https://ollama.com/blog/openai-compatibility
 */

export type LLMProvider = 'openrouter' | 'openai' | 'ollama' | 'custom';

export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

/** Role for chat messages. */
export type ChatRole = 'system' | 'user' | 'assistant';

/** A single chat message. */
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** Request body for chat completions. */
export interface ChatCompletionRequest {
  messages: ChatMessage[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  stop?: string | string[];
}

/** Choice in a chat completion response. */
export interface ChatCompletionChoice {
  index: number;
  message: {
    role: string;
    content: string | null;
  };
  finish_reason: string | null;
}

/** Response from chat completions endpoint. */
export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** Plugin context exposing config and request capabilities. */
export interface LLMPluginContext {
  getConfig(): LLMConfig;
  /** Obsidian's requestUrl for HTTP requests. */
  requestUrl(options: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    throw?: boolean;
  }): Promise<{
    status: number;
    json: unknown;
  }>;
}

/** Request adapter matching Obsidian requestUrl. */
export interface LLMRequestAdapter {
  (opts: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    throw?: boolean;
  }): Promise<{ status: number; json: unknown }>;
}

/**
 * Fetches available model IDs from the configured provider.
 *
 * @param requestAdapter - Adapter for HTTP requests (e.g. Obsidian requestUrl)
 * @param config - LLM provider config
 * @returns Array of model ID strings, or empty on error (never throws)
 */
export async function fetchModels(
  requestAdapter: LLMRequestAdapter,
  config: LLMConfig,
): Promise<string[]> {
  try {
    const headers = buildHeaders(config);

    if (config.provider === 'openrouter' || config.provider === 'openai') {
      if (!config.apiKey?.trim()) return [];
    }
    if (config.provider === 'custom' && !config.baseUrl?.trim()) return [];

    let url: string;
    let parseModels: (data: unknown) => string[];

    switch (config.provider) {
      case 'openrouter':
        url = 'https://openrouter.ai/api/v1/models';
        parseModels = (d) => {
          const obj = d as { data?: { id?: string }[] };
          return (obj?.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
        };
        break;
      case 'openai':
        url = 'https://api.openai.com/v1/models';
        parseModels = (d) => {
          const obj = d as { data?: { id?: string }[] };
          return (obj?.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
        };
        break;
      case 'ollama': {
        const base = (config.baseUrl?.trim() || 'http://localhost:11434/v1').replace(/\/v1\/?$/, '');
        url = `${base}/api/tags`;
        parseModels = (d) => {
          const obj = d as { models?: { name?: string; model?: string }[] };
          return (obj?.models ?? []).map((m) => m.name ?? m.model ?? '').filter(Boolean);
        };
        break;
      }
      case 'custom': {
        const base = config.baseUrl!.replace(/\/$/, '');
        url = `${base}/models`;
        parseModels = (d) => {
          const obj = d as { data?: { id?: string }[] };
          return (obj?.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
        };
        break;
      }
      default:
        return [];
    }

    const res = await requestAdapter({ url, method: 'GET', headers, throw: false });
    if (res.status >= 400) return [];

    const data = res.json;
    return parseModels(data) ?? [];
  } catch {
    return [];
  }
}

/**
 * Returns true if the LLM config has required credentials for the provider.
 */
export function isLLMConfigured(config: LLMConfig): boolean {
  switch (config.provider) {
    case 'openrouter':
    case 'openai':
      return !!config.apiKey?.trim();
    case 'custom':
      return !!config.baseUrl?.trim();
    case 'ollama':
      return true;
    default:
      return false;
  }
}

/** Resolves the base URL for chat completions based on provider config. */
export function resolveChatCompletionsBaseUrl(config: LLMConfig): string {
  switch (config.provider) {
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'ollama':
      return (config.baseUrl?.trim() || 'http://localhost:11434/v1').replace(/\/$/, '');
    case 'custom':
      const url = config.baseUrl?.trim();
      if (!url) {
        throw new Error('Custom provider requires a base URL. Add it in plugin settings.');
      }
      return url.replace(/\/$/, '');
    default: {
      const _: never = config.provider;
      throw new Error(`Unknown LLM provider: ${config.provider}`);
    }
  }
}

/**
 * Creates headers for LLM API requests.
 */
function buildHeaders(config: LLMConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const apiKey = config.apiKey?.trim();
  const authValue = config.provider === 'ollama' ? (apiKey || 'ollama') : apiKey;
  if (authValue) {
    headers['Authorization'] = `Bearer ${authValue}`;
  }
  return headers;
}

/**
 * Validates that the config has required credentials for the provider.
 */
function validateConfig(config: LLMConfig): void {
  if (config.provider === 'openrouter' || config.provider === 'openai') {
    if (!config.apiKey?.trim()) {
      throw new Error(`${config.provider} API key is not configured. Add it in plugin settings.`);
    }
  }
}

/**
 * Sends a chat completion request to the configured LLM endpoint.
 *
 * @param ctx - Plugin context with config and request function
 * @param request - Chat completion request body
 * @returns Parsed response or throws on error
 */
export async function chatCompletion(
  ctx: LLMPluginContext,
  request: ChatCompletionRequest,
): Promise<ChatCompletionResponse> {
  const config = ctx.getConfig();
  validateConfig(config);

  const baseUrl = resolveChatCompletionsBaseUrl(config);
  const url = `${baseUrl}/chat/completions`;
  const headers = buildHeaders(config);

  const model = request.model ?? config.model;
  const body = JSON.stringify({ ...request, ...(model ? { model } : {}) });

  const res = await ctx.requestUrl({
    url,
    method: 'POST',
    headers,
    body,
    throw: false,
  });

  const data = res.json as unknown;
  if (typeof data !== 'object' || data === null) {
    throw new Error('LLM returned invalid JSON');
  }

  const obj = data as Record<string, unknown>;
  if (res.status >= 400) {
    const errMsg =
      (obj?.error as { message?: string })?.message ??
      (typeof obj?.error === 'string' ? obj.error : null) ??
      `Request failed with status ${res.status}`;
    throw new Error(errMsg);
  }

  const choices = obj.choices as ChatCompletionChoice[] | undefined;
  if (!Array.isArray(choices)) {
    throw new Error('LLM response missing choices');
  }

  return data as ChatCompletionResponse;
}

/**
 * Convenience helper: send a single user message and get the assistant reply.
 *
 * @param ctx - Plugin context
 * @param userMessage - User message content
 * @param options - Optional model, system prompt, max_tokens, temperature
 * @returns The assistant reply text, or throws on error
 */
export async function simpleChat(
  ctx: LLMPluginContext,
  userMessage: string,
  options?: {
    model?: string;
    systemPrompt?: string;
    max_tokens?: number;
    temperature?: number;
  },
): Promise<string> {
  const messages: ChatMessage[] = [];
  if (options?.systemPrompt?.trim()) {
    messages.push({ role: 'system', content: options.systemPrompt.trim() });
  }
  messages.push({ role: 'user', content: userMessage });

  const config = ctx.getConfig();
  const model = options?.model ?? config.model;

  const response = await chatCompletion(ctx, {
    messages,
    model,
    max_tokens: options?.max_tokens,
    temperature: options?.temperature,
    stream: false,
  });

  const firstChoice = response.choices?.[0];
  if (!firstChoice) {
    throw new Error('LLM returned no choices');
  }

  const content = firstChoice.message?.content;
  return content ?? '';
}
