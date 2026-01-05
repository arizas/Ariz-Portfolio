import { test, expect } from '@playwright/test';

/**
 * Test intents tokens display in year report.
 * 
 * This test loads data from the accounting export server for a real account
 * and verifies that intents tokens (BTC, ETH, SOL, USDC, etc.) appear correctly
 * in the year report with proper network suffixes like "( NEAR Intents / Bitcoin )".
 * 
 * Expected token balances at end of 2025 for webassemblymusic-treasury.sputnik-dao.near:
 * (from accounting-export-integration.spec.js)
 * 
 * - wNEAR: 800000000000000000000000 (0.8 wNEAR)
 * - ETH: 35015088429776132 (0.035 ETH)  
 * - BTC: 544253 (0.00544253 BTC)
 * - USDC (ETH bridge): 124833020 (124.83 USDC)
 * - USDC (NEAR native): 119000000 (119 USDC)
 * - XRP: 16692367 (16.69 XRP)
 * - SOL: 83424010 (0.083 SOL)
 * - USDC (Base): 9999980 (~10 USDC)
 * - AVAX: 1514765442315238852 (1.51 AVAX)
 * - ARIZCREDITS: 2500000 (2.5M ARIZ)
 */

test('Intents tokens in year report - full flow', async ({ page }) => {
  test.setTimeout(120_000); // 2 minutes for loading data from server

  // Capture console errors
  page.on('pageerror', err => {
    console.log('BROWSER ERROR:', err.message);
  });


  // Start at home page with empty IndexedDB
  await page.goto('/');
  
  // Navigate to Accounts page
  await page.getByRole('link', { name: 'Accounts' }).click();
  
  // Add the treasury account
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByRole('textbox').fill('webassemblymusic-treasury.sputnik-dao.near');
  
  // Load from server (accounting export)
  await page.getByRole('button', { name: 'load from server' }).click();
  
  // Wait for progress bar to appear and disappear
  const progressbar = page.locator('progress-bar');
  try {
    await progressbar.waitFor({ state: 'visible', timeout: 10_000 });
    await progressbar.waitFor({ state: 'hidden', timeout: 90_000 });
  } catch {
    await page.waitForTimeout(5000);
  }
  
  // Wait for data to be fully saved to IndexedDB
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-results/01-after-load.png' });
  
  // Navigate to Year Report
  await page.getByRole('link', { name: 'Year report' }).click();
  
  // Wait for the page to load and token dropdown to be populated
  await page.locator('#yearselect').waitFor({ state: 'visible' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-results/02-year-report-loaded.png' });
  
  // Select year 2025 (the year with most token activity)
  await page.locator('#yearselect').selectOption('2025');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'test-results/03-year-2025-selected.png' });
  
  // === SCENARIO 1: Verify intents tokens appear with network suffixes ===
  const tokenSelect = page.locator('#tokenselect');
  await expect(tokenSelect).toBeVisible();
  
  const options = await tokenSelect.locator('option').allTextContents();
  console.log('Token options found:', options);
  
  // Verify intents tokens have network suffix
  const intentsPattern = /\( NEAR Intents \//;
  const intentsOptions = options.filter(opt => intentsPattern.test(opt));
  console.log('Intents token options:', intentsOptions);
  
  // Should have intents tokens (BTC, ETH, SOL, USDC variants)
  expect(intentsOptions.length).toBeGreaterThan(0);
  
  // Check for specific blockchain suffixes
  const hasEthereum = options.some(opt => opt.includes('( NEAR Intents / Ethereum )'));
  const hasBitcoin = options.some(opt => opt.includes('( NEAR Intents / Bitcoin )'));
  const hasSolana = options.some(opt => opt.includes('( NEAR Intents / Solana )'));
  
  console.log('Has Ethereum token:', hasEthereum);
  console.log('Has Bitcoin token:', hasBitcoin);
  console.log('Has Solana token:', hasSolana);
  
  expect(hasEthereum || hasBitcoin || hasSolana).toBeTruthy();
  
  // === SCENARIO 2: Verify multiple USDC entries from different chains ===
  const usdcOptions = options.filter(opt => opt.toUpperCase().includes('USDC'));
  console.log('USDC options:', usdcOptions);
  
  // Should have multiple USDC variants (ETH, NEAR, Base, Solana)
  expect(usdcOptions.length).toBeGreaterThanOrEqual(2);
  
  // === SCENARIO 3: Select BTC token and verify transactions ===
  let btcOptionValue = null;
  const allOptions = tokenSelect.locator('option');
  const optionCount = await allOptions.count();
  
  for (let i = 0; i < optionCount; i++) {
    const text = await allOptions.nth(i).textContent();
    if (text && text.includes('BTC')) {
      btcOptionValue = await allOptions.nth(i).getAttribute('value');
      console.log(`Found BTC option: "${text}" with value: ${btcOptionValue}`);
      break;
    }
  }
  
  expect(btcOptionValue).not.toBeNull();
  
  await tokenSelect.selectOption(btcOptionValue);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'test-results/04-btc-selected.png' });
  
  // Check that we have transaction rows for BTC
  let rows = page.locator('#dailybalancestable tr');
  let rowCount = await rows.count();
  console.log(`BTC transaction rows: ${rowCount}`);
  expect(rowCount).toBeGreaterThan(0);
  
  // === SCENARIO 4: Select ARIZCREDITS (regular fungible token) ===
  let arizOptionValue = null;
  for (let i = 0; i < optionCount; i++) {
    const text = await allOptions.nth(i).textContent();
    if (text && (text.includes('ARIZ') || text.includes('arizcredits'))) {
      arizOptionValue = await allOptions.nth(i).getAttribute('value');
      console.log(`Found ARIZ option: "${text}" with value: ${arizOptionValue}`);
      break;
    }
  }
  
  if (arizOptionValue) {
    await tokenSelect.selectOption(arizOptionValue);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'test-results/05-ariz-selected.png' });

    rows = page.locator('#dailybalancestable tr');
    rowCount = await rows.count();
    console.log(`ARIZCREDITS transaction rows: ${rowCount}`);

    // Expected: At least 1 row (some transactions may be outside the 2025 date range)
    expect(rowCount).toBeGreaterThan(0);

    // Verify year-end balance (2025-12-31)
    // Expected: 2500000 (with 0 decimals = 2.5M ARIZ, displayed as 2.5)
    const arizYearEndRow = page.locator('#dailybalancestable tr').filter({ hasText: '2025-12-31' });
    if (await arizYearEndRow.count() > 0) {
      const arizBalanceText = await arizYearEndRow.locator('td').nth(1).textContent(); // total balance column
      const arizBalance = parseFloat(arizBalanceText.trim().replace(/,/g, ''));
      console.log(`ARIZCREDITS balance on 2025-12-31: ${arizBalance}`);
      // Expected: 2.5 (2.5M with 6 decimals display)
      expect(arizBalance).toBe(2.5);
    }
  }
  
  // === SCENARIO 5: Select USDC (NEAR native) and verify year-end balance ===
  let usdcNearOptionValue = null;
  for (let i = 0; i < optionCount; i++) {
    const value = await allOptions.nth(i).getAttribute('value');
    // USDC (NEAR native) has contract_id: nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1
    if (value && value.includes('17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1')) {
      const text = await allOptions.nth(i).textContent();
      usdcNearOptionValue = value;
      console.log(`Found USDC (NEAR) option: "${text}" with value: ${usdcNearOptionValue}`);
      break;
    }
  }

  if (usdcNearOptionValue) {
    await tokenSelect.selectOption(usdcNearOptionValue);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'test-results/07-usdc-near-selected.png' });

    rows = page.locator('#dailybalancestable tr');
    rowCount = await rows.count();
    console.log(`USDC (NEAR) transaction rows: ${rowCount}`);
    expect(rowCount).toBeGreaterThan(0);

    // Verify year-end balance (2025-12-31)
    // Expected from accounting-export-integration.spec.js: 119000000 (with 6 decimals = 119 USDC)
    const yearEndRow = page.locator('#dailybalancestable tr').filter({ hasText: '2025-12-31' });
    if (await yearEndRow.count() > 0) {
      const balanceText = await yearEndRow.locator('td').nth(1).textContent(); // total balance column
      const balance = parseFloat(balanceText.trim().replace(/,/g, ''));
      console.log(`USDC (NEAR) balance on 2025-12-31: ${balance}`);
      // Expected: 119 USDC
      expect(balance).toBe(119);
    }
  }

  // === SCENARIO 6: Select ETH token and verify ===
  let ethOptionValue = null;
  for (let i = 0; i < optionCount; i++) {
    const text = await allOptions.nth(i).textContent();
    if (text && text.includes('ETH') && text.includes('Ethereum')) {
      ethOptionValue = await allOptions.nth(i).getAttribute('value');
      console.log(`Found ETH option: "${text}" with value: ${ethOptionValue}`);
      break;
    }
  }

  if (ethOptionValue) {
    await tokenSelect.selectOption(ethOptionValue);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'test-results/08-eth-selected.png' });

    rows = page.locator('#dailybalancestable tr');
    rowCount = await rows.count();
    console.log(`ETH transaction rows: ${rowCount}`);
    expect(rowCount).toBeGreaterThan(0);
  }
});
