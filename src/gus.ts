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
 * Escape a string for use in SOQL LIKE patterns (double single quotes).
 */
function escapeSoqlString(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Escape SOSL reserved characters: ? & | ! { } [ ] ( ) ^ ~ : \ " ' + -
 * Asterisk (*) is a valid SOSL wildcard — do not escape it.
 */
function escapeSoslString(s: string): string {
  return s.replace(/[?&|!{}[\]()^~:\\"'+=-]/g, '\\$&');
}

/**
 * Convert plain text to HTML for Salesforce rich text fields.
 * Escapes HTML, converts ## to h3, ### to strong, newlines to br.
 */
export function convertTextToHtml(text: string): string {
  const escape = (str: string) =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const lines = text.split('\n');
  const processed: string[] = [];
  let prevWasHeader = false;

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (stripped === '' && prevWasHeader) {
      prevWasHeader = false;
      continue;
    }
    if (stripped.startsWith('###')) {
      const headerText = stripped.slice(3).trim();
      processed.push(`<strong>${escape(headerText)}</strong>`);
      prevWasHeader = true;
    } else if (stripped.startsWith('##')) {
      const headerText = stripped.slice(2).trim();
      processed.push(`<h3>${escape(headerText)}</h3>`);
      prevWasHeader = true;
    } else {
      processed.push(escape(lines[i]));
      prevWasHeader = false;
    }
  }

  const result: string[] = [];
  for (let i = 0; i < processed.length; i++) {
    result.push(processed[i]);
    const lineType = processed[i].startsWith('<h3>')
      ? 'h3'
      : processed[i].startsWith('<strong>')
        ? 'strong'
        : 'normal';
    if (i < processed.length - 1 && (lineType === 'normal' || lineType === 'strong')) {
      if (processed[i].trim()) result.push('<br>');
    }
  }
  return result.join('');
}

/** Product tag search result. */
export interface ProductTagSearchResult {
  Id: string;
  Name: string;
}

/** Epic search result. */
export interface EpicSearchResult {
  Id: string;
  Name: string;
}

/** SOSL search response for product tags. */
interface SoslSearchResponse {
  searchRecords?: Array<{ Id: string; Name: string }>;
}

/**
 * Search for product tags by name using SOSL.
 * SOSL provides full-text search with relevance ranking and wildcards.
 */
export async function searchProductTags(
  accessToken: string,
  instanceUrl: string,
  searchTerm: string,
  requestFn?: RequestFn,
): Promise<ProductTagSearchResult[]> {
  const trimmed = searchTerm.trim();
  if (!trimmed) return [];

  const base = instanceUrl.replace(/\/$/, '');
  const req = requestFn ?? defaultRequest;
  const escaped = escapeSoslString(trimmed);
  const sosl = `FIND {${escaped}*} IN ALL FIELDS RETURNING ADM_Product_Tag__c(Id, Name) LIMIT 10`;
  const url = `${base}/services/data/${API_VERSION}/search?q=${encodeURIComponent(sosl)}`;
  const res = await req(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json().catch(() => ({}))) as SoslSearchResponse & {
    [0]?: { message?: string };
    message?: string;
  };
  if (!res.ok) {
    const msg =
      data[0]?.message ?? data.message ?? `HTTP ${res.status}`;
    throw new Error(`Product tag search failed: ${msg}`);
  }
  const records = data.searchRecords ?? [];
  return records.map((r) => ({ Id: r.Id, Name: r.Name }));
}

/**
 * Get current user ID for epic team filtering.
 * Uses OAuth userinfo endpoint.
 */
async function getCurrentUserId(
  accessToken: string,
  instanceUrl: string,
  requestFn?: RequestFn,
): Promise<string | null> {
  try {
    const info = await fetchUserInfo(accessToken, instanceUrl, requestFn);
    return info?.user_id ?? null;
  } catch {
    return null;
  }
}

/** SOSL search response for epics. */
interface SoslEpicSearchResponse {
  searchRecords?: Array<{ Id: string; Name: string }>;
}

/**
 * Fetch team IDs for the current user (for epic team filtering).
 */
async function getUserTeamIds(
  accessToken: string,
  instanceUrl: string,
  requestFn?: RequestFn,
): Promise<string[]> {
  const userId = await getCurrentUserId(accessToken, instanceUrl, requestFn);
  if (!userId) return [];
  const base = instanceUrl.replace(/\/$/, '');
  const req = requestFn ?? defaultRequest;
  const escapedUser = escapeSoqlString(userId);
  const soql = `SELECT Scrum_Team__c FROM ADM_Scrum_Team_Member__c WHERE Member_Name__c = '${escapedUser}' LIMIT 100`;
  const res = await req(
    `${base}/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const data = (await res.json().catch(() => ({}))) as SoqlResponse;
  if (!res.ok) return [];
  const records = (data.records ?? []) as Array<{ Scrum_Team__c?: string }>;
  return records
    .map((r) => r.Scrum_Team__c)
    .filter((id): id is string => !!id);
}

/**
 * Search for epics by name using SOSL for fuzzy full-text search.
 * When restrictToMyTeams is true, only returns epics from teams the user belongs to.
 */
export async function searchEpics(
  accessToken: string,
  instanceUrl: string,
  searchTerm: string,
  requestFn?: RequestFn,
  restrictToMyTeams = true,
): Promise<EpicSearchResult[]> {
  const trimmed = searchTerm.trim();
  if (!trimmed) return [];

  const base = instanceUrl.replace(/\/$/, '');
  const req = requestFn ?? defaultRequest;
  const escaped = escapeSoslString(trimmed);

  let whereClause = '';
  if (restrictToMyTeams) {
    const teamIds = await getUserTeamIds(accessToken, instanceUrl, requestFn);
    if (teamIds.length > 0) {
      const quotedIds = teamIds
        .map((id) => `'${id.replace(/'/g, "''")}'`)
        .join(',');
      whereClause = ` WHERE Team__c IN (${quotedIds})`;
    }
  }

  const sosl = `FIND {${escaped}*} IN ALL FIELDS RETURNING ADM_Epic__c(Id, Name${whereClause}) LIMIT 10`;
  const url = `${base}/services/data/${API_VERSION}/search?q=${encodeURIComponent(sosl)}`;
  const res = await req(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = (await res.json().catch(() => ({}))) as SoslEpicSearchResponse & {
    [0]?: { message?: string };
    message?: string;
  };
  if (!res.ok) {
    const msg =
      data[0]?.message ?? data.message ?? `HTTP ${res.status}`;
    throw new Error(`Epic search failed: ${msg}`);
  }
  const records = data.searchRecords ?? [];
  return records.map((r) => ({ Id: r.Id, Name: r.Name }));
}

/**
 * Get RecordTypeId for User Story work items.
 */
export async function getUserStoryRecordTypeId(
  accessToken: string,
  instanceUrl: string,
  requestFn?: RequestFn,
): Promise<string | null> {
  const base = instanceUrl.replace(/\/$/, '');
  const req = requestFn ?? defaultRequest;
  const soql =
    "SELECT Id FROM RecordType WHERE SObjectType = 'ADM_Work__c' AND DeveloperName = 'User_Story' LIMIT 1";
  const res = await req(
    `${base}/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const data = (await res.json().catch(() => ({}))) as SoqlResponse;
  if (!res.ok || !data.records?.length) return null;
  return (data.records[0] as { Id: string }).Id;
}

/** Payload for creating a work item. */
export interface CreateWorkItemPayload {
  Subject__c: string;
  Details__c: string;
  Product_Tag__c: string;
  RecordTypeId: string;
  Type__c?: string;
  Epic__c?: string;
  Story_Points__c?: number;
  Assignee__c?: string;
}

/** Result of creating a work item. */
export interface CreateWorkItemResult {
  id: string;
  name: string;
  url: string;
}

/**
 * Create a work item in GUS and return its id and name.
 */
export async function createWorkItem(
  accessToken: string,
  instanceUrl: string,
  payload: CreateWorkItemPayload,
  requestFn?: RequestFn,
): Promise<CreateWorkItemResult> {
  const base = instanceUrl.replace(/\/$/, '');
  const req = requestFn ?? defaultRequest;
  const url = `${base}/services/data/${API_VERSION}/sobjects/ADM_Work__c`;
  const body = {
    Subject__c: payload.Subject__c,
    Details__c: payload.Details__c,
    Product_Tag__c: payload.Product_Tag__c,
    RecordTypeId: payload.RecordTypeId,
    Type__c: payload.Type__c ?? 'User Story',
    ...(payload.Epic__c && { Epic__c: payload.Epic__c }),
    ...(payload.Story_Points__c != null && { Story_Points__c: payload.Story_Points__c }),
    ...(payload.Assignee__c && { Assignee__c: payload.Assignee__c }),
  };

  const res = await req(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    success?: boolean;
    errors?: unknown[];
  };

  if (!res.ok || !data.success) {
    const msg =
      (Array.isArray(data.errors) ? data.errors[0] : data.errors) as { message?: string } | undefined;
    throw new Error(
      msg?.message ?? `Create work item failed: HTTP ${res.status}`,
    );
  }

  const workItemId = data.id as string;
  if (!workItemId) throw new Error('Create work item returned no id');

  // Fetch the record to get the Name (e.g. W-12345)
  const soql = `SELECT Id, Name FROM ADM_Work__c WHERE Id = '${workItemId.replace(/'/g, "''")}' LIMIT 1`;
  const getRes = await req(
    `${base}/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const getData = (await getRes.json().catch(() => ({}))) as SoqlResponse;
  const name =
    getData.records?.[0] && 'Name' in getData.records[0]
      ? String((getData.records[0] as { Name?: string }).Name ?? workItemId)
      : workItemId;

  return {
    id: workItemId,
    name,
    url: `${base}/${workItemId}`,
  };
}

/** Payload for creating an epic. */
export interface CreateEpicPayload {
  Name: string;
  Description__c?: string;
}

/** Result of creating an epic. */
export interface CreateEpicResult {
  id: string;
  name: string;
  url: string;
}

/**
 * Create an epic (ADM_Epic__c) in GUS.
 * Epics do not have Product_Tag__c; product tags apply only to work items.
 */
export async function createEpic(
  accessToken: string,
  instanceUrl: string,
  payload: CreateEpicPayload,
  requestFn?: RequestFn,
): Promise<CreateEpicResult> {
  const base = instanceUrl.replace(/\/$/, '');
  const req = requestFn ?? defaultRequest;
  const url = `${base}/services/data/${API_VERSION}/sobjects/ADM_Epic__c`;
  const body: Record<string, string> = {
    Name: payload.Name,
  };
  if (payload.Description__c) {
    body.Description__c = payload.Description__c;
  }

  const res = await req(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    success?: boolean;
    errors?: unknown[];
  };

  if (!res.ok || !data.success) {
    const msg =
      (Array.isArray(data.errors) ? data.errors[0] : data.errors) as { message?: string } | undefined;
    throw new Error(
      msg?.message ?? `Create epic failed: HTTP ${res.status}`,
    );
  }

  const epicId = data.id as string;
  if (!epicId) throw new Error('Create epic returned no id');

  return {
    id: epicId,
    name: payload.Name,
    url: `${base}/${epicId}`,
  };
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
