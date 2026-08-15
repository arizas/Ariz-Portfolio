import { test, expect } from '@playwright/test';
import { TEST_ACCOUNT_ROW_COUNT, loadTestAccountAndOpenTransactions } from '../util/transactions-testflow.js';

/**
 * Full-flow test for the records-driven Transactions page.
 *
 * Loads the cached accounting fixture for the test account, navigates to
 * /transactions, and verifies that:
 * - rows render at all (regression check: the storage layer must persist the
 *   raw V2 records, not the converted V1-like shape — that bug shipped once)
 * - the table contains records for tokens beyond NEAR (FT + NEAR Intents)
 * - the resolved-symbol column shows human names (not just contract IDs)
 * - the raw token_id is also visible alongside the symbol
 */
test('Transactions page renders FT + Intents records, not just NEAR', async ({ page }) => {
  test.setTimeout(120_000);

  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('BROWSER CONSOLE ERROR:', msg.text());
  });

  await loadTestAccountAndOpenTransactions(page);
  await page.screenshot({ path: 'test-results/transactions-page.png', fullPage: true });

  // === Assertions ===

  // The empty-state must NOT be visible. If it is, the storage-layer write
  // didn't persist the raw V2 records (regression check for the bug where
  // fetchAccountingExportJSON converted before persisting).
  const emptyState = page.locator('transactions-page').locator('#emptystate');
  await expect(emptyState).toBeHidden();

  // 4 records in the fixture, 1 of which is a staking-pool record → 3 rendered rows
  const rows = page.locator('transactions-page').locator('#transactionstable tr');
  expect(await rows.count()).toBe(TEST_ACCOUNT_ROW_COUNT);

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
