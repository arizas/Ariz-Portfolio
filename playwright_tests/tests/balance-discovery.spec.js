import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.describe('Balance-based Transaction Discovery', () => {
    test('should discover transactions and navigate to year report', async ({ page }) => {
        // Set a longer timeout for this comprehensive test
        test.setTimeout(180000); // 3 minutes

        // Load RPC cache
        const archiveRpcCachePath = path.join(process.cwd(), 'testdata', 'archiverpccache.json');
        let archiveRpcCache = {};

        if (fs.existsSync(archiveRpcCachePath)) {
            archiveRpcCache = JSON.parse(fs.readFileSync(archiveRpcCachePath, 'utf-8'));
        }

        // Intercept RPC requests and use cache
        await page.route('https://archival-rpc.mainnet.fastnear.com/', async (route) => {
            const request = route.request();
            const postData = request.postData();

            if (archiveRpcCache[postData]) {
                // Return cached response
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: archiveRpcCache[postData]
                });
            } else {
                // Continue with actual request and cache the response
                const response = await route.fetch();
                const body = await response.text();

                try {
                    const resultObj = JSON.parse(body);
                    if (!resultObj.error) {
                        archiveRpcCache[postData] = body;
                        fs.writeFileSync(archiveRpcCachePath, JSON.stringify(archiveRpcCache, null, 1));
                    }
                } catch (e) {
                    console.error('Error parsing RPC response:', e);
                }

                await route.fulfill({
                    status: response.status(),
                    headers: response.headers(),
                    body
                });
            }
        });

        // Set up environment variable to use test RPC endpoint (bypasses proxy client)
        await page.addInitScript(() => {
            // Set test RPC endpoint to bypass proxy client requirement
            window.process = window.process || {};
            window.process.env = window.process.env || {};
            window.process.env.TEST_RPC_ENDPOINT = 'https://archival-rpc.mainnet.fastnear.com';
        });

        // Navigate to the application
        await page.goto('/');

        // Wait for the app to load
        await page.waitForSelector('nav');

        // Click on the Accounts menu item
        await page.click('text=Accounts');

        // Wait for the accounts page to load
        await page.waitForSelector('button:has-text("Add account")');

        // Click "Add account" button
        await page.click('button:has-text("Add account")');

        // Wait for the input field to appear
        await page.waitForSelector('input[type="text"]');

        // Enter the account ID
        await page.fill('input[type="text"]', 'ariz-treasury.sputnik-dao.near');

        // Click the "load data" button
        await page.click('button:has-text("load data")');

        // Wait for transaction discovery to complete
        // This could take a while as it searches through many blocks
        await page.waitForSelector('table', { timeout: 180000 });

        // Wait a bit more for all transactions to be discovered
        await page.waitForTimeout(5000);

        // Get all transaction rows
        const transactionRows = await page.locator('table tbody tr').count();

        console.log(`Found ${transactionRows} transaction rows`);

        // Verify we found a reasonable number of transactions
        expect(transactionRows).toBeGreaterThanOrEqual(18);

        // Navigate to Year Report page
        await page.click('text=Year Report');

        // Wait for year report page to load
        await page.waitForTimeout(2000);

        console.log('Navigated to Year Report page');
    });
});
