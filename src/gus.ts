/**
 * GUS (Salesforce work tracking) integration.
 *
 * Implements PKCE OAuth login via browser and SOQL work-item queries.
 * Uses injectable openBrowser, tokenStorage, and requestFn for testability and
 * platform abstraction. In Obsidian, pass requestUrl-based adapter to avoid CORS.
 */

import { createHash, randomBytes } from 'crypto';
import { createServer } from 'http';

const DEFAULT_INSTANCE = 'gus.my.salesforce.com';
const DEFAULT_REDIRECT_URI = 'http://localhost:1717/OauthRedirect';
const DEFAULT_SCOPES = 'refresh_token api web';
const DEFAULT_CLIENT_ID = 'PlatformCLI';
const API_VERSION = 'v51.0';
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_TOKEN_MAX_AGE_HOURS = 8;

/** Configuration for GUS connection. */
export interface GusConfig {
  instance: string;
  clientId: string;
  redirectUri: string;
  scopes: string;
  defaultTeam?: string;
  defaultProductTag?: string;
}

/** Cached token with timestamp. */
export interface CachedToken {
  accessToken: string;
  instanceUrl: string;
  timeCollected: string;
}

/** Storage interface for token persistence. */
export interface TokenStorage {
  get(): Promise<CachedToken | null>;
  set(data: CachedToken): Promise<void>;
}

/** Token response from OAuth token endpoint. */
export interface TokenResponse {
  access_token: string;
  instance_url: string;
  refresh_token?: string;
  token_type?: string;
}

/** User info from /services/oauth2/userinfo. */
export interface UserInfo {
  user_id: string;
}

/** Work item from ADM_Work__c. */
export interface GusWorkItem {
  id: string;
  name: string;
  subject: string;
  status: string;
  description?: string;
  currencyIsoCode?: string;
  severity?: string;
  assigneeId?: string;
  createdDate?: string;
  lastModifiedDate?: string;
}

/** Values for query template substitution. */
export interface QueryTemplateValues {
  me?: string;
  team?: string;
  product_tag?: string;
}

/** HTTP request function; use Obsidian requestUrl to avoid CORS. */
export interface RequestFn {
  (
    url: string,
    options?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    },
  ): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
}

/** Options for loginViaBrowser. */
export interface LoginViaBrowserOptions {
  config?: Partial<GusConfig>;
  openBrowser: (url: string) => void | Promise<void>;
  requestFn?: RequestFn;
  port?: number;
}

/** Options for getAuthenticatedClient. */
export interface GetAuthenticatedClientOptions {
  config?: Partial<GusConfig>;
  openBrowser: (url: string) => void | Promise<void>;
  requestFn?: RequestFn;
  tokenStorage?: TokenStorage;
  maxAgeHours?: number;
  port?: number;
}

/** Default GUS config. */
export const DEFAULT_GUS_CONFIG: GusConfig = {
  instance: DEFAULT_INSTANCE,
  clientId: DEFAULT_CLIENT_ID,
  redirectUri: DEFAULT_REDIRECT_URI,
  scopes: DEFAULT_SCOPES,
};

/**
 * Merge partial config with defaults.
 */
function resolveConfig(partial?: Partial<GusConfig>): GusConfig {
  return { ...DEFAULT_GUS_CONFIG, ...partial };
}

/**
 * Generate a PKCE code verifier (43–128 chars, base64url).
 */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Generate PKCE code challenge: base64url(SHA256(verifier)).
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'utf8').digest('base64url');
}

/**
 * Build the OAuth authorization URL for PKCE flow.
 */
export function buildAuthUrl(options: {
  config?: Partial<GusConfig>;
  codeChallenge: string;
  state: string;
}): string {
  const config = resolveConfig(options.config);
  const instance = config.instance.startsWith('http')
    ? config.instance
    : `https://${config.instance}`;
  const base = instance.replace(/\/$/, '');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    code_challenge: options.codeChallenge,
    code_challenge_method: 'S256',
    scope: config.scopes,
    state: options.state,
  });
  return `${base}/services/oauth2/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for access token.
 */
export async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  config?: Partial<GusConfig>,
  requestFn?: RequestFn,
): Promise<TokenResponse> {
  const c = resolveConfig(config);
  const instance = c.instance.startsWith('http')
    ? c.instance
    : `https://${c.instance}`;
  const base = instance.replace(/\/$/, '');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: c.redirectUri,
    client_id: c.clientId,
    code_verifier: codeVerifier,
  });
  const req = requestFn ?? defaultRequest;
  const res = await req(`${base}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error_description?: string; message?: string }).error_description ??
      (data as { error_description?: string; message?: string }).message ??
      `HTTP ${res.status}`;
    throw new Error(`Token exchange failed: ${msg}`);
  }
  return data as TokenResponse;
}

/** Default request: uses fetch (subject to CORS in Obsidian renderer). */
const defaultRequest: RequestFn = async (url, options) => {
  const res = await fetch(url, {
    method: options?.method,
    headers: options?.headers,
    body: options?.body,
  });
  return {
    ok: res.ok,
    status: res.status,
    json: () => res.json(),
  };
};

/**
 * Perform PKCE login via browser: start callback server, open auth URL, exchange code.
 */
export async function loginViaBrowser(
  options: LoginViaBrowserOptions,
): Promise<TokenResponse> {
  const config = resolveConfig(options.config);
  const port = options.port ?? 1717;
  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = randomBytes(16).toString('base64url');
  const authUrl = buildAuthUrl({ config, codeChallenge: challenge, state });

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      if (url.pathname !== '/OauthRedirect') {
        res.writeHead(404);
        res.end();
        return;
      }
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const errorDesc = url.searchParams.get('error_description');

      const html = (msg: string) =>
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>GUS Auth</title></head><body><p>${msg}</p></body></html>`;

      if (error) {
        clearTimeout(timeoutId);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html(`Error: ${errorDesc ?? error}`));
        server.close();
        reject(new Error(`OAuth error: ${errorDesc ?? error}`));
        return;
      }
      if (returnedState !== state) {
        clearTimeout(timeoutId);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html('Invalid state parameter. Please try again.'));
        server.close();
        reject(new Error('Invalid state parameter'));
        return;
      }
      if (!code) {
        clearTimeout(timeoutId);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html('No authorization code received. Please try again.'));
        server.close();
        reject(new Error('No authorization code received'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html('Success! You can close this window.'));
      clearTimeout(timeoutId);
      server.close();

      try {
        const token = await exchangeCodeForToken(
          code,
          verifier,
          config,
          options.requestFn,
        );
        resolve(token);
      } catch (err) {
        reject(err);
      }
    });

    const timeoutId = setTimeout(() => {
      server.close();
      reject(new Error('Login callback timed out. Please try again.'));
    }, CALLBACK_TIMEOUT_MS);

    server.listen(port, () => {
      Promise.resolve(options.openBrowser(authUrl)).catch(reject);
    });

    server.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

/**
 * Fetch current user info from Salesforce.
 */
export async function fetchUserInfo(
  accessToken: string,
  instanceUrl: string,
  requestFn?: RequestFn,
): Promise<UserInfo> {
  const base = instanceUrl.replace(/\/$/, '');
  const req = requestFn ?? defaultRequest;
  const res = await req(`${base}/services/oauth2/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error_description?: string; message?: string })
      .error_description ??
      (data as { error_description?: string; message?: string }).message ??
      `HTTP ${res.status}`;
    throw new Error(`User info failed: ${msg}`);
  }
  return data as UserInfo;
}

/** Raw SOQL response record. */
interface SoqlRecord {
  attributes?: { type: string; url?: string };
  Id: string;
  Name?: string;
  Subject__c?: string;
  Status__c?: string;
  Details__c?: string;
  CurrencyIsoCode?: string;
  Severity__c?: string;
  Assignee__c?: string;
  CreatedDate?: string;
  LastModifiedDate?: string;
}

/** Raw SOQL query response. */
interface SoqlResponse {
  totalSize?: number;
  done: boolean;
  records: SoqlRecord[];
  nextRecordsUrl?: string;
}

/**
 * Parse ADM_Work__c record into GusWorkItem.
 */
function parseWorkItem(rec: SoqlRecord): GusWorkItem {
  return {
    id: rec.Id,
    name: rec.Name ?? '',
    subject: rec.Subject__c ?? '',
    status: rec.Status__c ?? '',
    description: rec.Details__c,
    currencyIsoCode: rec.CurrencyIsoCode,
    severity: rec.Severity__c,
    assigneeId: rec.Assignee__c,
    createdDate: rec.CreatedDate,
    lastModifiedDate: rec.LastModifiedDate,
  };
}

/**
 * Execute SOQL query and return work items with pagination.
 */
export async function queryWorkItems(
  accessToken: string,
  instanceUrl: string,
  soql: string,
  requestFn?: RequestFn,
): Promise<GusWorkItem[]> {
  const base = instanceUrl.replace(/\/$/, '');
  const req = requestFn ?? defaultRequest;
  const allRecords: GusWorkItem[] = [];
  let url: string | null = `${base}/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`;

  while (url) {
    const res = await req(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        (data as { 0?: { message?: string }; message?: string })[0]?.message ??
        (data as { message?: string }).message ??
        `HTTP ${res.status}`;
      throw new Error(`SOQL query failed: ${msg}`);
    }
    const body = data as SoqlResponse;
    for (const rec of body.records ?? []) {
      allRecords.push(parseWorkItem(rec));
    }
    if (body.done) {
      url = null;
    } else if (body.nextRecordsUrl) {
      url = `${base}${body.nextRecordsUrl}`;
    } else {
      url = null;
    }
  }
  return allRecords;
}

/**
 * Substitute placeholders in a query template.
 * Placeholders: ${me}, ${team}, ${product_tag}
 * Unknown placeholders are left unchanged.
 */
export function substituteQueryTemplate(
  template: string,
  values: QueryTemplateValues,
): string {
  return template
    .replace(/\$\{me\}/g, values.me ?? '${me}')
    .replace(/\$\{team\}/g, values.team ?? '${team}')
    .replace(/\$\{product_tag\}/g, values.product_tag ?? '${product_tag}');
}

/**
 * Get authenticated client: use cached token if valid, else run login.
 */
export async function getAuthenticatedClient(
  options: GetAuthenticatedClientOptions,
): Promise<{ accessToken: string; instanceUrl: string }> {
  const maxAgeHours = options.maxAgeHours ?? DEFAULT_TOKEN_MAX_AGE_HOURS;
  const storage = options.tokenStorage;

  if (storage) {
    const cached = await storage.get();
    if (cached) {
      const collected = new Date(cached.timeCollected).getTime();
      const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
      if (Date.now() - collected < maxAgeMs) {
        return {
          accessToken: cached.accessToken,
          instanceUrl: cached.instanceUrl,
        };
      }
    }
  }

  const token = await loginViaBrowser({
    config: options.config,
    openBrowser: options.openBrowser,
    requestFn: options.requestFn,
    port: options.port,
  });

  const cached: CachedToken = {
    accessToken: token.access_token,
    instanceUrl: token.instance_url,
    timeCollected: new Date().toISOString(),
  };
  if (storage) {
    await storage.set(cached);
  }

  return {
    accessToken: cached.accessToken,
    instanceUrl: cached.instanceUrl,
  };
}
