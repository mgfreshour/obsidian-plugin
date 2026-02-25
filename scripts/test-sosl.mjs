#!/usr/bin/env node
/**
 * Temp script to test SOSL product tag search.
 *
 * SOSL provides full-text search with relevance ranking and wildcards.
 * ADM_Product_Tag__c must be searchable (IsSearchable=true) in your org.
 *
 * Usage:
 *   GUS_ACCESS_TOKEN=... GUS_INSTANCE_URL=... node scripts/test-sosl.mjs [search term]
 *
 * Or with SF CLI authenticated to GUS:
 *   sf org login web --instance-url https://gus.my.salesforce.com --alias=GusProduction
 *   node scripts/test-sosl.mjs [search term]
 *
 * If no search term is provided, defaults to "sales".
 */

const searchTerm = process.argv[2]?.trim() || 'sales';
const instanceUrl =
  process.env.GUS_INSTANCE_URL || 'https://gus.my.salesforce.com';

async function getAccessToken() {
  if (process.env.GUS_ACCESS_TOKEN) {
    return process.env.GUS_ACCESS_TOKEN;
  }
  const { execSync } = await import('child_process');
  try {
    const out = execSync(
      'sf org display --json --target-org GusProduction 2>/dev/null',
      { encoding: 'utf-8' },
    );
    const data = JSON.parse(out);
    return data.result?.accessToken ?? null;
  } catch {
    return null;
  }
}

/**
 * Escape SOSL reserved characters: ? & | ! { } [ ] ( ) ^ ~ : \ " ' + -
 * Asterisk (*) is a valid SOSL wildcard - do not escape it.
 */
function escapeSosl(s) {
  return s.replace(/[?&|!{}[\]()^~:\\"'+=-]/g, '\\$&');
}

async function runSoslSearch(accessToken, searchQuery) {
  // FIND {'term'} IN ALL FIELDS RETURNING ObjectType(fields) LIMIT n
  const escaped = escapeSosl(searchQuery);
  const sosl = `FIND {${escaped}*} IN ALL FIELDS RETURNING ADM_Product_Tag__c(Id, Name) LIMIT 10`;
  const url = `${instanceUrl.replace(/\/$/, '')}/services/data/v51.0/search?q=${encodeURIComponent(sosl)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SOSL failed ${res.status}: ${text}`);
  }

  return res.json();
}

async function main() {
  console.log('SOSL Product Tag Search Test\n');
  console.log('Search term:', searchTerm);
  console.log('Instance:', instanceUrl);
  console.log('');

  const accessToken = await getAccessToken();
  if (!accessToken) {
    console.error(
      'No access token. Set GUS_ACCESS_TOKEN or run: sf org login web --instance-url https://gus.my.salesforce.com --alias=GusProduction',
    );
    process.exit(1);
  }

  try {
    const result = await runSoslSearch(accessToken, searchTerm);
    console.log('SOSL response:', JSON.stringify(result, null, 2));

    const records = result?.searchRecords ?? [];
    if (records.length === 0) {
      console.log('\nNo results. Try a different search term or check if ADM_Product_Tag__c is SOSL-searchable.');
    } else {
      console.log('\nMatched product tags:');
      records.forEach((r, i) => console.log(`  ${i + 1}. ${r.Name} (${r.Id})`));
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
