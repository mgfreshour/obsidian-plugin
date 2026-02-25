# GUS Integration Guide

This document describes how to log into and use GUS (Salesforce work tracking) so the same functionality can be implemented in another language or product. GUS is a Salesforce-based work management system. Integration is achieved via the **Salesforce REST API** and **SOQL** (Salesforce Object Query Language).

---

## 1. Overview

### What is GUS?

- **GUS** = Salesforce work tracking used internally for bugs, user stories, epics, and related work items
- Built on top of the **Salesforce Platform** (custom SObjects)
- Access requires authentication and the appropriate Salesforce instance (e.g. `gus.my.salesforce.com`)

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Instance** | Salesforce host (e.g. `gus.my.salesforce.com`) |
| **Access Token** | OAuth access token used for API requests |
| **SObject** | Salesforce Object (custom or standard). GUS work items use `ADM_Work__c` |
| **SOQL** | Query language for Salesforce data |

---

## 2. Authentication

Two authentication methods are supported.

### 2.1 PKCE (Recommended for CLI/desktop apps)

PKCE (Proof Key for Code Exchange) is an OAuth 2.0 flow that does **not** require a client secret. It suits desktop/CLI tools that can open a browser.

#### Prerequisites

- A **Connected App** in Salesforce Setup with:
  - **Authorization Code Flow** enabled
  - **Require Secret for Web Server Flow** unchecked (for public client)
  - Callback URL: `http://localhost:1717/OauthRedirect`
  - Scopes: `refresh_token`, `api`, `web`

#### PKCE Flow

1. **Generate PKCE values**
   - `code_verifier`: 43–128 character random string (e.g. base64url)
   - `code_challenge`: base64url(SHA256(code_verifier))

2. **Build authorization URL**

   ```
   https://<instance>/services/oauth2/authorize?
     response_type=code
     &client_id=<Connected_App_Client_Id>
     &redirect_uri=http://localhost:1717/OauthRedirect
     &code_challenge=<code_challenge>
     &code_challenge_method=S256
     &scope=refresh_token api web
     &state=<random_state>
   ```

3. **Receive callback**
   - Start a local HTTP server on port 1717
   - Open the authorization URL in the browser
   - User logs in and approves
   - Salesforce redirects to `http://localhost:1717/OauthRedirect?code=<auth_code>&state=<state>`
   - Validate `state` matches, capture `code`
   - Shut down the server

4. **Exchange code for token**

   ```
   POST https://<instance>/services/oauth2/token
   Content-Type: application/x-www-form-urlencoded

   grant_type=authorization_code
   &code=<auth_code>
   &redirect_uri=http://localhost:1717/OauthRedirect
   &client_id=<client_id>
   &code_verifier=<code_verifier>
   ```

   Response:

   ```json
   {
     "access_token": "...",
     "refresh_token": "...",
     "instance_url": "https://gus.my.salesforce.com",
     "token_type": "Bearer",
     ...
   }
   ```

5. **Use the access token** as `Authorization: Bearer <access_token>` on all API requests.

#### Reference Values

| Parameter | Value |
|-----------|-------|
| Base URL | `https://gus.my.salesforce.com` |
| Auth endpoint | `https://gus.my.salesforce.com/services/oauth2/authorize` |
| Token endpoint | `https://gus.my.salesforce.com/services/oauth2/token` |
| Client ID | `PlatformCLI` (or your Connected App ID) |
| Redirect URI | `http://localhost:1717/OauthRedirect` |
| Scopes | `refresh_token api web` |

### 2.2 Password Flow (Username + Password)

For scripts or automated workflows where PKCE is impractical.

1. Create a Connected App with **Password** grant enabled
2. Send:

   ```
   POST https://<instance>/services/oauth2/token
   Content-Type: application/x-www-form-urlencoded

   grant_type=password
   &client_id=<client_id>
   &client_secret=<client_secret>
   &username=<salesforce_username>
   &password=<password><security_token>
   ```

   Note: Salesforce `password` must include an appended security token when not from a trusted IP.

3. Response includes `access_token`; use it like PKCE.

---

## 3. Token Caching

Access tokens expire (typically 2 hours). To avoid re-authenticating every run:

### Cache Structure

Store a JSON object:

```json
{
  "timeCollected": "2025-02-24T12:00:00.000Z",
  "accessToken": "..."
}
```

### Caching Logic

1. Check cached token and `timeCollected`
2. If `timeCollected` is within `maxAgeHours` (e.g. 8), use cached token
3. Otherwise run PKCE (or password) flow to get a new token
4. Store the result and timestamp

### Storage Options by Platform

| Platform | Approach |
|----------|----------|
| macOS | `security` CLI: `find-generic-password` / `add-generic-password` |
| Windows | Credential Manager (WinAPI or `cmdkey`) |
| Linux | `secret-tool` (gnome-keyring) or encrypted file |
| Cross-platform | Encrypted file in user config dir |

Cache key format: `sfdx-cache:<instance>` (e.g. `sfdx-cache:gus.my.salesforce.com`)

---

## 4. Configuration

Configuration can be file-based (e.g. TOML) or environment-based.

### Required Keys

| Key | Description | Example |
|-----|-------------|---------|
| `GUS.instance` | Salesforce instance host | `gus.my.salesforce.com` |
| `GUS.auth` | Auth method | `pkce` or `password` |
| `GUS.username` | (Password auth only) | `user@company.com` |
| `GUS.password` | (Password auth only) | `...` + security token |

### Optional Keys

| Key | Description | Example |
|-----|-------------|---------|
| `GUS.queries.default` | Default SOQL WHERE clause template | `WHERE Assignee__c = '${me}'` |
| `GUS.default_team` | Team for query substitution | `MyTeam` |
| `GUS.default_product_tag` | Product for query substitution | `MyProduct` |

### Query Template Substitution

Templates support placeholders:

- `${me}` → Current user ID (from `/services/oauth2/userinfo` or identity)
- `${team}` → `GUS.default_team`
- `${product_tag}` → `GUS.default_product_tag`

Example: `WHERE Assignee__c = '${me}' AND Scrum_Team__r.Name = '${team}'`

---

## 5. API Base Configuration

Once you have an access token:

- **Instance URL** from token response: `https://<instance>`
- **API version** (path prefix): `v51.0` (use a recent supported version)
- **Base path**: `https://<instance>/services/data/v51.0`

All REST calls require:

```
Authorization: Bearer <access_token>
```

---

## 6. Core Operations

### 6.1 Verify Identity

```
GET https://<instance>/services/oauth2/userinfo
Authorization: Bearer <access_token>
```

Returns user info including `user_id` (needed for `${me}` substitution).

### 6.2 Execute SOQL Query

```
GET https://<instance>/services/data/v51.0/query?q=<url_encoded_soql>
Authorization: Bearer <access_token>
```

Example SOQL:

```sql
SELECT Id, Name, Subject__c, Status__c, CurrencyIsoCode, CreatedDate
FROM ADM_Work__c
WHERE Assignee__c = '005xxxxxxxxxxxxxxx'
```

Response:

```json
{
  "totalSize": 2,
  "done": true,
  "records": [
    {
      "attributes": { "type": "ADM_Work__c", ... },
      "Id": "a06...",
      "Name": "W-12345",
      "Subject__c": "Fix login bug",
      "Status__c": "In Progress",
      ...
    }
  ]
}
```

### 6.3 Pagination

If `done` is `false`, there is a `nextRecordsUrl`. Fetch it:

```
GET https://<instance><nextRecordsUrl>
Authorization: Bearer <access_token>
```

Combine records from all pages for full result set.

### 6.4 Create Record

```
POST https://<instance>/services/data/v51.0/sobjects/ADM_Work__c
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "Name": "W-auto",
  "Subject__c": "New work item",
  "Status__c": "New",
  "CurrencyIsoCode": "USD",
  ...
}
```

Response:

```json
{
  "id": "a06...",
  "success": true,
  "errors": []
}
```

### 6.5 Retrieve by ID

```
GET https://<instance>/services/data/v51.0/sobjects/ADM_Work__c/<id>
Authorization: Bearer <access_token>
```

### 6.6 Update Record

```
PATCH https://<instance>/services/data/v51.0/sobjects/ADM_Work__c/<id>
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "Status__c": "In Progress"
}
```

### 6.7 Add Feed Post (Comment)

Use the standard `FeedItem` object with `ParentId` set to the work item Id:

```
POST https://<instance>/services/data/v51.0/sobjects/FeedItem
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "ParentId": "<work_item_id>",
  "Body": "Comment text here",
  "IsRichText": false
}
```

---

## 7. Data Model

### 7.1 Work Item (ADM_Work__c)

Primary SObject for GUS work items (bugs, stories, epics).

| Field (API) | Type | Description |
|-------------|------|-------------|
| Id | string | Salesforce ID (15 or 18 chars) |
| Name | string | Display name (e.g. W-12345) |
| Subject__c | string | Subject/title |
| Status__c | string | New, In Progress, Ready for Review, Closed, Never |
| CurrencyIsoCode | string | USD, EUR, etc. |
| Severity | string | Crash, Bug - no workaround, etc. |
| Assignee__c | string | User ID of assignee |
| CreatedDate | datetime | Creation time |
| LastModifiedDate | datetime | Last update |

### 7.2 Status Values

Valid `Status__c` values:

- `New`
- `In Progress`
- `Ready for Review`
- `Closed`
- `Never`

### 7.3 Severity Values (Bugs)

- Crash
- Bug - no workaround
- Bug - workaround
- Annoying
- Cosmetic
- Major Feature
- Minor Feature
- Trivial

### 7.4 Record Types

Work items have record types (e.g. User Story vs Bug). RecordTypeId values are org-specific; use the Describe API or Setup to obtain them if needed.

### 7.5 FeedItem

Standard object for feed posts. Key fields:

- `ParentId` – Id of the work item (or other parent)
- `Body` – Comment text
- `Type` – e.g. `TextPost`
- `IsRichText` – boolean

---

## 8. Workflow Operations Summary

| Operation | API | Notes |
|-----------|-----|-------|
| List work items | SOQL query on ADM_Work__c | Use query template with `${me}` |
| Get by name | SOQL `WHERE Name = 'W-1234'` | Returns single record |
| Create work item | POST sobjects/ADM_Work__c | Requires required fields |
| Update status | PATCH sobjects/ADM_Work__c/:id | Set Status__c |
| Add comment | POST sobjects/FeedItem | ParentId = work item Id |
| Remove from kanban | PATCH | Set column/kanban field to empty (org-dependent) |
| Sort by priority | Query + batch PATCH | Update Priority_Rank__c |

---

## 9. Error Handling

- **401 Unauthorized**: Token expired or invalid → refresh/re-auth
- **403 Forbidden**: Insufficient permissions
- **404 Not Found**: Invalid Id or object
- **400 Bad Request**: Check request body and field values

Salesforce error responses include a JSON body with `message` and `errorCode`.

---

## 10. Implementation Checklist

Use this when porting to another language or product.

- [ ] **Auth**: Implement PKCE flow (or password flow if required)
  - [ ] Code verifier and challenge generation (S256)
  - [ ] Local callback server (default port 1717)
  - [ ] Token exchange
- [ ] **Token cache**: Store token + timestamp; reuse if within TTL
- [ ] **Config**: Load `GUS.instance`, `GUS.auth`, optional username/password
- [ ] **Query templates**: Support `${me}`, `${team}`, `${product_tag}` substitution
- [ ] **SOQL**: URL-encode query; handle pagination via `nextRecordsUrl`
- [ ] **CRUD**: Create, retrieve, update for ADM_Work__c
- [ ] **FeedItem**: Create feed posts with ParentId = work item Id
- [ ] **Identity**: Call userinfo to get current user Id for `${me}`

---

## 11. References

- [Salesforce REST API Developer Guide](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/)
- [SOQL Reference](https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/)
- [OAuth 2.0 Web Server Flow](https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_web_server_flow.htm)
- [Connected Apps](https://help.salesforce.com/s/articleView?id=sf.connected_app_create.htm)
