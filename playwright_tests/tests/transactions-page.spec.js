import { test, expect } from '@playwright/test';
import { setupApiMocks } from '../util/api-mocks.js';

/**
 * Full-flow test for the records-driven Transactions page.
 *
 * Loads the cached accounting fixture for webassemblymusic-treasury.sputnik-dao.near,
 * navigates to /transactions, and verifies that:
 * - rows render at all (regression check: the storage layer must persist the
 *   raw V2 records, not the converted V1-like shape — that bug shipped once)
 * - the table contains records for tokens beyond NEAR (FT + NEAR Intents)
 * - the resolved-symbol column shows human names (not just contract IDs)
 * - the raw token_id is also visible alongside the symbol
 */
test('Transactions page renders FT + Intents records, not just NEAR', async ({ page }) => {
  test.setTimeout(120_000);

  await setupApiMocks(page);

  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('BROWSER CONSOLE ERROR:', msg.text());
  });

  // Start fresh
  await page.goto('/');

  // Add the test account via the Accounts page. Uses a synthetic V2 fixture
  // (testdata/accountingexport/accounts_tx-page-test.near_download_json.json)
  // with a known mix of NEAR + FT + Intents + staking-pool records.
  const testAccount = 'tx-page-test.near';
  await page.getByRole('link', { name: 'Accounts' }).click();
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByRole('textbox').fill(testAccount);

  // Click "load from server" — this should now also persist records.json
  await page.getByRole('button', { name: 'load from server' }).click();

  // Wait for the load to finish
  const progressbar = page.locator('progress-bar');
  try {
    await progressbar.waitFor({ state: 'visible', timeout: 10_000 });
    await progressbar.waitFor({ state: 'hidden', timeout: 90_000 });
  } catch {
    await page.waitForTimeout(5000);
  }
  await page.waitForTimeout(2000);

  // Navigate to Transactions
  await page.getByRole('link', { name: 'Transactions' }).click();

  // Pick the loaded account
  const accountSelect = page.locator('transactions-page').locator('#accountselect');
  await expect(accountSelect).toBeVisible();
  await accountSelect.selectOption(testAccount);

  // Wait briefly for symbol/decimal resolution (intents metadata + RPC for unknown FTs)
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'test-results/transactions-page.png', fullPage: true });

  // === Assertions ===

  // The empty-state must NOT be visible. If it is, the storage-layer write
  // didn't persist the raw V2 records (regression check for the bug where
  // fetchAccountingExportJSON converted before persisting).
  const emptyState = page.locator('transactions-page').locator('#emptystate');
  await expect(emptyState).toBeHidden();

  // 4 records in the fixture, 1 of which is a staking-pool record → 3 rendered rows
  const rows = page.locator('transactions-page').locator('#transactionstable tr');
  expect(await rows.count()).toBe(3);

  // Distinct token_ids cover NEAR + FT + Intents (staking pool is filtered out)
  const rawTokenIds = await page.locator('transactions-page').locator('.txrow_token_id').allTextContents();
  const uniqueTokenIds = new Set(rawTokenIds);
  expect(uniqueTokenIds.has('near')).toBeTruthy();
  expect(uniqueTokenIds.has('arizcredits.near')).toBeTruthy();
  expect(uniqueTokenIds.has('nep141:btc.omft.near')).toBeTruthy();
  // Staking-pool record from the fixture must NOT appear
  expect([...uniqueTokenIds].some(id => id.includes('.poolv1.near'))).toBe(false);

  // Resolved symbols
  const symbols = await page.locator('transactions-page').locator('.txrow_token_symbol').allTextContents();
  expect(symbols).toContain('NEAR');                             // native NEAR
  expect(symbols.some(s => s.includes('NEAR Intents'))).toBe(true);  // BTC via Intents
});
