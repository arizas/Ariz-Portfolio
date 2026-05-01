import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const testdataDir = join(__dirname, '../../testdata');
const accountingExportDir = join(testdataDir, 'accountingexport');
const intentsTokensCacheFile = join(testdataDir, 'intents-tokens-cache.json');

// Cache for intents tokens metadata
let intentsTokensCache = null;

/**
 * Load intents tokens cache from file
 */
async function loadIntentsTokensCache() {
    if (intentsTokensCache) return intentsTokensCache;

    try {
        const data = await readFile(intentsTokensCacheFile, 'utf-8');
        intentsTokensCache = JSON.parse(data);
        return intentsTokensCache;
    } catch {
        intentsTokensCache = [];
        return intentsTokensCache;
    }
}

/**
 * Save intents tokens to cache file
 */
async function saveIntentsTokensCache(tokens) {
    intentsTokensCache = tokens;
    await writeFile(intentsTokensCacheFile, JSON.stringify(tokens, null, 2));
}

/**
 * Setup API route mocking for Playwright tests
 * This intercepts accounting export and intents token API calls,
 * using cached data when available and caching new responses.
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 */
export async function setupApiMocks(page) {
    // Ensure accounting export cache directory exists
    try {
        await stat(accountingExportDir);
    } catch {
        await mkdir(accountingExportDir, { recursive: true });
    }

    // Mock accounting export API - cache each URL as a separate file.
    // The new gateway URL has no accountId in the path; we extract it from the
    // bearer token so each cached account gets its own fixture file.
    await page.route('https://arizgateway.fly.dev/api/accounting/**/*', async (route) => {
        const url = route.request().url();
        const subPath = new URL(url).pathname.replace(/^\/api\/accounting\//, '').replace(/\//g, '_');

        // Decode accountId from the bearer token's base64 payload.
        const auth = route.request().headers()['authorization'] ?? '';
        const tokenPayload = auth.replace(/^Bearer\s+/i, '').split('.')[0];
        let accountId = 'unknown';
        try {
            accountId = JSON.parse(Buffer.from(tokenPayload, 'base64').toString()).accountId ?? 'unknown';
        } catch { /* keep 'unknown' */ }

        const urlPath = `accounts_${accountId}_${subPath}`;
        const cacheFile = join(accountingExportDir, `${urlPath}.json`);

        try {
            const body = await readFile(cacheFile, 'utf-8');
            console.log(`[API Mock] Serving cached: ${urlPath}`);
            await route.fulfill({
                body,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Cache-Hit': 'true'
                }
            });
        } catch {
            // Not in cache - fetch from real server
            console.log(`[API Mock] Fetching from server: ${url}`);
            try {
                const response = await route.fetch();
                const body = await response.text();
                if (response.ok()) {
                    await writeFile(cacheFile, body);
                    console.log(`[API Mock] Cached: ${urlPath}`);
                }
                await route.fulfill({ body, status: response.status() });
            } catch (e) {
                console.error(`[API Mock] Failed to fetch: ${url}`, e);
                await route.abort('connectionfailed');
            }
        }
    });

    // Mock intents token metadata API
    await page.route('https://1click.chaindefuser.com/v0/tokens', async (route) => {
        const cache = await loadIntentsTokensCache();

        if (cache && cache.length > 0) {
            console.log(`[API Mock] Serving cached intents tokens: ${cache.length} entries`);
            await route.fulfill({
                json: cache,
                headers: { 'X-Cache-Hit': 'true' }
            });
        } else {
            // Fetch from real server and cache
            console.log('[API Mock] Fetching intents tokens from server...');
            try {
                const response = await route.fetch();
                const body = await response.text();
                if (response.ok()) {
                    const tokens = JSON.parse(body);
                    await saveIntentsTokensCache(tokens);
                    console.log(`[API Mock] Cached ${tokens.length} intents tokens`);
                }
                await route.fulfill({ body, status: response.status() });
            } catch (e) {
                console.error('[API Mock] Failed to fetch intents tokens:', e);
                // Return empty array as fallback
                await route.fulfill({ json: [] });
            }
        }
    });

    // Mock RPC calls with caching
    await page.route('https://rpc.mainnet.fastnear.com/', async (route) => {
        // Allow RPC calls to go through - they're fast and idempotent
        // But we could add caching here if needed
        await route.continue();
    });
}
