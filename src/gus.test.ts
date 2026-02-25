import {
  buildAuthUrl,
  DEFAULT_GUS_CONFIG,
  exchangeCodeForToken,
  fetchUserInfo,
  generateCodeChallenge,
  generateCodeVerifier,
  getAuthenticatedClient,
  loginViaBrowser,
  queryWorkItems,
  substituteQueryTemplate,
} from './gus';

describe('generateCodeVerifier', () => {
  it('returns string of length 43-128', () => {
    for (let i = 0; i < 20; i++) {
      const v = generateCodeVerifier();
      expect(v.length).toBeGreaterThanOrEqual(43);
      expect(v.length).toBeLessThanOrEqual(128);
    }
  });

  it('returns URL-safe base64 chars only', () => {
    const v = generateCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns different values each call', () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });
});

describe('generateCodeChallenge', () => {
  it('produces valid base64url string', () => {
    const verifier = 'test_verifier_12345';
    const challenge = generateCodeChallenge(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('is deterministic for same verifier', () => {
    const verifier = 'same_verifier';
    expect(generateCodeChallenge(verifier)).toBe(
      generateCodeChallenge(verifier),
    );
  });

  it('differs for different verifiers', () => {
    expect(generateCodeChallenge('a')).not.toBe(generateCodeChallenge('b'));
  });
});

describe('buildAuthUrl', () => {
  it('contains instance and all required params', () => {
    const url = buildAuthUrl({
      codeChallenge: 'challenge123',
      state: 'state456',
    });
    const parsed = new URL(url);
    expect(parsed.origin).toContain('gus.my.salesforce.com');
    expect(parsed.pathname).toContain('/services/oauth2/authorize');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('code_challenge')).toBe('challenge123');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('client_id')).toBe('PlatformCLI');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'http://localhost:1717/OauthRedirect',
    );
    expect(parsed.searchParams.get('scope')).toContain('refresh_token');
    expect(parsed.searchParams.get('state')).toBe('state456');
  });

  it('uses custom config when provided', () => {
    const url = buildAuthUrl({
      config: {
        instance: 'custom.my.salesforce.com',
        clientId: 'CustomClient',
      },
      codeChallenge: 'x',
      state: 's',
    });
    expect(url).toContain('custom.my.salesforce.com');
    expect(new URL(url).searchParams.get('client_id')).toBe('CustomClient');
  });
});

describe('substituteQueryTemplate', () => {
  it('replaces ${me}', () => {
    expect(
      substituteQueryTemplate('WHERE Assignee__c = \'${me}\'', { me: '005xxx' }),
    ).toBe("WHERE Assignee__c = '005xxx'");
  });

  it('replaces ${team}', () => {
    expect(
      substituteQueryTemplate('Scrum_Team__r.Name = \'${team}\'', {
        team: 'MyTeam',
      }),
    ).toBe("Scrum_Team__r.Name = 'MyTeam'");
  });

  it('replaces ${product_tag}', () => {
    expect(
      substituteQueryTemplate('Product_Tag__c = \'${product_tag}\'', {
        product_tag: 'MyProduct',
      }),
    ).toBe("Product_Tag__c = 'MyProduct'");
  });

  it('replaces all placeholders', () => {
    const result = substituteQueryTemplate(
      'WHERE Assignee__c = \'${me}\' AND Scrum_Team__r.Name = \'${team}\'',
      { me: '005a', team: 'Alpha' },
    );
    expect(result).toBe(
      "WHERE Assignee__c = '005a' AND Scrum_Team__r.Name = 'Alpha'",
    );
  });

  it('leaves unknown placeholders unchanged', () => {
    expect(substituteQueryTemplate('x = ${unknown}', {})).toBe(
      'x = ${unknown}',
    );
  });

  it('leaves ${me} when not provided', () => {
    expect(substituteQueryTemplate('WHERE ${me}', {})).toBe('WHERE ${me}');
  });
});

describe('exchangeCodeForToken', () => {
  const mockToken = {
    access_token: 'tok123',
    instance_url: 'https://gus.my.salesforce.com',
    refresh_token: 'ref456',
  };

  beforeEach(() => {
    globalThis.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('POSTs to token endpoint with form body', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockToken,
    });
    const result = await exchangeCodeForToken(
      'auth_code_xyz',
      'verifier_abc',
    );
    expect(result).toEqual(mockToken);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://gus.my.salesforce.com/services/oauth2/token',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: expect.stringContaining('grant_type=authorization_code'),
      }),
    );
    const body = (globalThis.fetch as jest.Mock).mock.calls[0][1].body;
    expect(body).toContain('code=auth_code_xyz');
    expect(body).toContain('code_verifier=verifier_abc');
  });

  it('throws on non-ok response', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'invalid_grant',
        error_description: 'Invalid code',
      }),
    });
    await expect(
      exchangeCodeForToken('bad', 'verifier'),
    ).rejects.toThrow('Token exchange failed');
  });
});

describe('fetchUserInfo', () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('GETs userinfo with Bearer token', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ user_id: '005xxxxxxxxxxxxxxx' }),
    });
    const result = await fetchUserInfo(
      'access_token_here',
      'https://gus.my.salesforce.com',
    );
    expect(result).toEqual({ user_id: '005xxxxxxxxxxxxxxx' });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://gus.my.salesforce.com/services/oauth2/userinfo',
      {
        headers: { Authorization: 'Bearer access_token_here' },
      },
    );
  });

  it('throws on 401', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Session expired' }),
    });
    await expect(
      fetchUserInfo('bad', 'https://gus.my.salesforce.com'),
    ).rejects.toThrow('User info failed');
  });
});

describe('queryWorkItems', () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('executes SOQL and parses work items', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        totalSize: 1,
        done: true,
        records: [
          {
            Id: 'a06xxx',
            Name: 'W-12345',
            Subject__c: 'Fix login bug',
            Status__c: 'In Progress',
            CurrencyIsoCode: 'USD',
          },
        ],
      }),
    });
    const result = await queryWorkItems(
      'token',
      'https://gus.my.salesforce.com',
      "SELECT Id, Name FROM ADM_Work__c WHERE Name = 'W-12345'",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'a06xxx',
      name: 'W-12345',
      subject: 'Fix login bug',
      status: 'In Progress',
      currencyIsoCode: 'USD',
      assigneeId: undefined,
      createdDate: undefined,
      lastModifiedDate: undefined,
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('q='),
      { headers: { Authorization: 'Bearer token' } },
    );
    const url = (globalThis.fetch as jest.Mock).mock.calls[0][0];
    expect(decodeURIComponent(url)).toContain(
      "SELECT Id, Name FROM ADM_Work__c WHERE Name = 'W-12345'",
    );
  });

  it('handles pagination via nextRecordsUrl', async () => {
    (globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          done: false,
          records: [{ Id: '1', Name: 'W-1', Subject__c: 'A', Status__c: 'New' }],
          nextRecordsUrl: '/services/data/v51.0/query/01gxxx',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          done: true,
          records: [{ Id: '2', Name: 'W-2', Subject__c: 'B', Status__c: 'New' }],
        }),
      });
    const result = await queryWorkItems(
      'token',
      'https://gus.my.salesforce.com',
      'SELECT Id FROM ADM_Work__c',
    );
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('W-1');
    expect(result[1].name).toBe('W-2');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect((globalThis.fetch as jest.Mock).mock.calls[1][0]).toBe(
      'https://gus.my.salesforce.com/services/data/v51.0/query/01gxxx',
    );
  });

  it('throws on SOQL error', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => [{ message: 'No such column' }],
    });
    await expect(
      queryWorkItems('token', 'https://gus.my.salesforce.com', 'SELECT x'),
    ).rejects.toThrow('SOQL query failed');
  });
});

describe('loginViaBrowser', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts server, opens browser, captures callback, exchanges token', async () => {
    const mockToken = {
      access_token: 'tok',
      instance_url: 'https://gus.my.salesforce.com',
    };
    const port = 31717;
    (globalThis.fetch as jest.Mock).mockImplementation(
      (url: string | URL | Request, init?: RequestInit) => {
        const urlStr =
          typeof url === 'string'
            ? url
            : url instanceof URL
              ? url.href
              : (url as Request).url;
        if (urlStr.includes(`localhost:${port}`)) {
          return realFetch(url, init);
        }
        return Promise.resolve({
          ok: true,
          json: async () => mockToken,
        });
      },
    );

    const openBrowser = jest.fn(async (authUrl: string) => {
      await new Promise((r) => setImmediate(r));
      const u = new URL(authUrl);
      const state = u.searchParams.get('state');
      await realFetch(
        `http://localhost:${port}/OauthRedirect?code=mock_auth_code&state=${state}`,
      );
    });

    const result = await loginViaBrowser({
      openBrowser,
      config: { redirectUri: 'http://localhost:31717/OauthRedirect' },
      port: 31717,
    });
    expect(result).toEqual(mockToken);
    expect(openBrowser).toHaveBeenCalledWith(
      expect.stringContaining('gus.my.salesforce.com'),
    );
  });

  it('rejects on invalid state in callback', async () => {
    const port = 31718;
    const openBrowser = jest.fn(async () => {
      await new Promise((r) => setImmediate(r));
      await realFetch(
        `http://localhost:${port}/OauthRedirect?code=code&state=wrong_state`,
      );
    });

    await expect(
      loginViaBrowser({
        openBrowser,
        config: { redirectUri: `http://localhost:${port}/OauthRedirect` },
        port,
      }),
    ).rejects.toThrow('Invalid state');
  });

  it('rejects on OAuth error param', async () => {
    const port = 31719;
    const openBrowser = jest.fn(async () => {
      await new Promise((r) => setImmediate(r));
      await realFetch(
        `http://localhost:${port}/OauthRedirect?error=access_denied&error_description=User+denied`,
      );
    });

    await expect(
      loginViaBrowser({
        openBrowser,
        config: { redirectUri: `http://localhost:${port}/OauthRedirect` },
        port,
      }),
    ).rejects.toThrow('OAuth error');
  });
});

describe('getAuthenticatedClient', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns cached token when fresh', async () => {
    const cached = {
      accessToken: 'cached_tok',
      instanceUrl: 'https://gus.my.salesforce.com',
      timeCollected: new Date().toISOString(),
    };
    const storage = {
      get: jest.fn().mockResolvedValue(cached),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const openBrowser = jest.fn();

    const result = await getAuthenticatedClient({
      tokenStorage: storage,
      openBrowser,
      maxAgeHours: 8,
    });
    expect(result).toEqual({
      accessToken: 'cached_tok',
      instanceUrl: 'https://gus.my.salesforce.com',
    });
    expect(openBrowser).not.toHaveBeenCalled();
    expect(storage.get).toHaveBeenCalled();
  });

  it('calls loginViaBrowser when cache missing', async () => {
    const port = 31720;
    const storage = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const mockToken = {
      access_token: 'new_tok',
      instance_url: 'https://gus.my.salesforce.com',
    };
    (globalThis.fetch as jest.Mock).mockImplementation(
      (url: string | URL | Request) => {
        const urlStr =
          typeof url === 'string'
            ? url
            : url instanceof URL
              ? url.href
              : (url as Request).url;
        if (urlStr.includes(`localhost:${port}`)) {
          return realFetch(url);
        }
        return Promise.resolve({
          ok: true,
          json: async () => mockToken,
        });
      },
    );
    const openBrowser = jest.fn(async (authUrl: string) => {
      await new Promise((r) => setImmediate(r));
      const u = new URL(authUrl);
      const state = u.searchParams.get('state');
      await realFetch(
        `http://localhost:${port}/OauthRedirect?code=new_code&state=${state}`,
      );
    });

    const result = await getAuthenticatedClient({
      tokenStorage: storage,
      openBrowser,
      config: { redirectUri: `http://localhost:${port}/OauthRedirect` },
      port,
    });
    expect(result.accessToken).toBe('new_tok');
    expect(storage.set).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'new_tok',
        instanceUrl: 'https://gus.my.salesforce.com',
      }),
    );
  });

  it('calls loginViaBrowser when cache stale', async () => {
    const port = 31721;
    const oldDate = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
    const mockToken = {
      access_token: 'fresh_tok',
      instance_url: 'https://gus.my.salesforce.com',
    };
    const storage = {
      get: jest.fn().mockResolvedValue({
        accessToken: 'stale_tok',
        instanceUrl: 'https://gus.my.salesforce.com',
        timeCollected: oldDate,
      }),
      set: jest.fn().mockResolvedValue(undefined),
    };
    (globalThis.fetch as jest.Mock).mockImplementation(
      (url: string | URL | Request) => {
        const urlStr =
          typeof url === 'string'
            ? url
            : url instanceof URL
              ? url.href
              : (url as Request).url;
        if (urlStr.includes(`localhost:${port}`)) {
          return realFetch(url);
        }
        return Promise.resolve({
          ok: true,
          json: async () => mockToken,
        });
      },
    );
    const openBrowser = jest.fn(async (authUrl: string) => {
      await new Promise((r) => setImmediate(r));
      const u = new URL(authUrl);
      const state = u.searchParams.get('state');
      await realFetch(
        `http://localhost:${port}/OauthRedirect?code=code&state=${state}`,
      );
    });

    const result = await getAuthenticatedClient({
      tokenStorage: storage,
      openBrowser,
      config: { redirectUri: `http://localhost:${port}/OauthRedirect` },
      maxAgeHours: 8,
      port,
    });
    expect(result.accessToken).toBe('fresh_tok');
  });
});

describe('DEFAULT_GUS_CONFIG', () => {
  it('has expected defaults', () => {
    expect(DEFAULT_GUS_CONFIG.instance).toBe('gus.my.salesforce.com');
    expect(DEFAULT_GUS_CONFIG.clientId).toBe('PlatformCLI');
    expect(DEFAULT_GUS_CONFIG.redirectUri).toBe(
      'http://localhost:1717/OauthRedirect',
    );
    expect(DEFAULT_GUS_CONFIG.scopes).toContain('refresh_token');
  });
});
