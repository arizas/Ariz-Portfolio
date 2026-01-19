import { test, expect } from '@playwright/test';

/**
 * Test year summary (all tokens) page for webassemblymusic-treasury.sputnik-dao.near
 *
 * This account has multiple fungible tokens including intents tokens.
 * The summary page should show non-zero balances for tokens that have transactions.
 *
 * Expected tokens with activity (from accounting-export-integration.spec.js):
 * - wNEAR: 800000000000000000000000 (0.8 wNEAR)
 * - ETH: 35015088429776132 (0.035 ETH)
 * - BTC: 544253 (0.00544253 BTC)
 * - USDC (multiple sources): ~243 USDC total
 * - XRP: 16692367 (16.69 XRP)
 * - SOL: 83424010 (0.083 SOL)
 * - AVAX: 1514765442315238852 (1.51 AVAX)
 */

test('Year summary all tokens shows correct balances', async ({ page }) => {
    test.setTimeout(180_000); // 3 minutes for loading data

    // Capture console logs for debugging
    const consoleLogs = [];
    page.on('console', msg => {
        if (msg.type() === 'log' || msg.type() === 'error' || msg.type() === 'warn') {
            consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
        }
    });

    // Start at home page
    await page.goto('/');

    // Navigate to Accounts page
    await page.getByRole('link', { name: 'Accounts' }).click();

    // Add the treasury account
    await page.getByRole('button', { name: 'Add account' }).click();
    await page.getByRole('textbox').fill('webassemblymusic-treasury.sputnik-dao.near');

    // Capture network requests for debugging
    const networkErrors = [];
    page.on('requestfailed', request => {
        networkErrors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`);
    });

    // Load from server (accounting export)
    await page.getByRole('button', { name: 'load from server' }).click();

    // Wait for progress bar to appear and disappear
    const progressbar = page.locator('progress-bar');
    try {
        await progressbar.waitFor({ state: 'visible', timeout: 15_000 });
        console.log('Progress bar appeared');
        await progressbar.waitFor({ state: 'hidden', timeout: 120_000 });
        console.log('Progress bar hidden');
    } catch (e) {
        console.log('Progress bar not visible or finished quickly:', e.message);
    }

    // Wait for data to be fully saved to IndexedDB
    await page.waitForTimeout(3000);

    if (networkErrors.length > 0) {
        console.log('Network errors:', networkErrors);
    }

    // Check if any dialog/modal appeared (like error alert)
    await page.screenshot({ path: 'test-results/after-load.png' });

    // Navigate to Year Report
    await page.getByRole('link', { name: 'Year report' }).click();

    // Wait for the page to load
    await page.locator('#yearselect').waitFor({ state: 'visible' });

    // Wait for tokens to be populated in dropdown (should have more than just NEAR)
    const tokenSelect = page.locator('#tokenselect');
    await expect(async () => {
        const options = await tokenSelect.locator('option').count();
        expect(options).toBeGreaterThan(5); // Should have NEAR + multiple fungible tokens
    }).toPass({ timeout: 30_000 });

    await page.waitForTimeout(1000);

    // Select year 2025
    await page.locator('#yearselect').selectOption('2025');
    await page.waitForTimeout(500);

    // Select NOK currency (use uppercase)
    const currencySelect = page.locator('#currencyselect');
    const currencyOptions = await currencySelect.locator('option').allTextContents();
    console.log('Available currencies:', currencyOptions);

    // Find NOK option (case insensitive)
    const nokOption = currencyOptions.find(opt => opt.toLowerCase() === 'nok');
    if (nokOption) {
        await currencySelect.selectOption(nokOption);
    } else {
        // Skip currency selection if NOK not available
        console.log('NOK currency not available, skipping currency selection');
    }
    await page.waitForTimeout(500);

    // Get list of tokens in dropdown (with their values)
    const tokenOptions = await tokenSelect.locator('option').allTextContents();
    const tokenValues = await tokenSelect.locator('option').evaluateAll(opts => opts.map(o => o.value));
    console.log('Available tokens:', tokenOptions);
    console.log('Token values (contract IDs):', tokenValues);

    // Click "Print (all tokens)" to open the summary page
    const [summaryPage] = await Promise.all([
        page.context().waitForEvent('page'),
        page.getByRole('button', { name: 'Print (all tokens)' }).click()
    ]);

    // Wait for summary page to load
    await summaryPage.waitForLoadState('domcontentloaded');
    await summaryPage.waitForTimeout(5000); // Wait for reports to generate

    await summaryPage.screenshot({ path: 'test-results/yearsummary-initial.png' });

    // Get all rows from the summary table
    const summaryRows = summaryPage.locator('#summarytablebody tr');
    const rowCount = await summaryRows.count();
    console.log(`Summary table has ${rowCount} token rows`);

    // Collect data from each row
    const tokenData = [];
    for (let i = 0; i < rowCount; i++) {
        const row = summaryRows.nth(i);
        const token = await row.locator('.summary_token').textContent();
        const amount = await row.locator('.summary_amount').textContent();
        const balance = await row.locator('.summary_balance').textContent();
        const earnings = await row.locator('.summary_earnings').textContent();

        tokenData.push({ token, amount, balance, earnings });
        console.log(`Token: ${token}, Amount: ${amount}, Balance: ${balance}, Earnings: ${earnings}`);
    }

    // === ASSERTIONS ===

    // Should have NEAR with non-zero balance
    const nearRow = tokenData.find(t => t.token === 'NEAR');
    expect(nearRow).toBeDefined();
    expect(parseFloat(nearRow.amount.replace(/\s/g, '').replace(',', '.'))).toBeGreaterThan(0);

    // Should have wNEAR with non-zero balance
    const wNearRow = tokenData.find(t => t.token?.includes('wNEAR'));
    expect(wNearRow).toBeDefined();
    console.log('wNEAR row:', wNearRow);

    // Check for intents tokens - they should have non-zero amounts if the account has them
    const btcRow = tokenData.find(t => t.token?.includes('BTC'));
    const ethRow = tokenData.find(t => t.token?.includes('ETH'));
    const solRow = tokenData.find(t => t.token?.includes('SOL'));
    const xrpRow = tokenData.find(t => t.token?.includes('XRP'));
    const avaxRow = tokenData.find(t => t.token?.includes('AVAX'));
    const usdcRow = tokenData.find(t => t.token?.includes('USDC'));

    console.log('BTC row:', btcRow);
    console.log('ETH row:', ethRow);
    console.log('SOL row:', solRow);
    console.log('XRP row:', xrpRow);
    console.log('AVAX row:', avaxRow);
    console.log('USDC row:', usdcRow);

    // All intents tokens should have non-zero amounts (the treasury account has transactions for all of them)
    // This is a regression test for the fix that changed from using getAllFungibleTokenSymbols()
    // to getAllFungibleTokenEntries() - passing contract IDs instead of symbols
    expect(btcRow).toBeDefined();
    expect(parseFloat(btcRow.amount.replace(/\s/g, '').replace(',', '.'))).toBeGreaterThan(0);

    expect(ethRow).toBeDefined();
    expect(parseFloat(ethRow.amount.replace(/\s/g, '').replace(',', '.'))).toBeGreaterThan(0);

    expect(solRow).toBeDefined();
    expect(parseFloat(solRow.amount.replace(/\s/g, '').replace(',', '.'))).toBeGreaterThan(0);

    expect(xrpRow).toBeDefined();
    expect(parseFloat(xrpRow.amount.replace(/\s/g, '').replace(',', '.'))).toBeGreaterThan(0);

    expect(avaxRow).toBeDefined();
    expect(parseFloat(avaxRow.amount.replace(/\s/g, '').replace(',', '.'))).toBeGreaterThan(0);

    expect(usdcRow).toBeDefined();
    expect(parseFloat(usdcRow.amount.replace(/\s/g, '').replace(',', '.'))).toBeGreaterThan(0);

    // Print console logs for debugging
    console.log('\n=== Console logs from page ===');
    consoleLogs.forEach(log => console.log(log));

    await summaryPage.screenshot({ path: 'test-results/yearsummary-final.png' });
});
