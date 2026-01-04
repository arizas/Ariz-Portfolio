import { test, expect } from "@playwright/test";
import { pause500ifRecordingVideo } from "../util/videorecording.js";

test.describe("Intents tokens in year report", () => {
  test("should display Bitcoin and Ethereum daily balances", async ({ page }) => {
    test.setTimeout(120_000);
    
    await page.goto("/");
    
    // Navigate to accounts page
    await page.getByRole('link', { name: 'Accounts' }).click();
    await pause500ifRecordingVideo(page);

    // Add the treasury account
    await page.getByRole('button', { name: 'Add account' }).click();
    await pause500ifRecordingVideo(page);

    await page.getByRole('textbox').fill('webassemblymusic-treasury.sputnik-dao.near');
    await pause500ifRecordingVideo(page);

    // Load data from server
    await page.getByRole('button', { name: 'load from server' }).click();
    
    // Wait for progress bar to appear
    const progressbar = await page.locator('progress-bar');
    await progressbar.waitFor({ state: 'visible', timeout: 15 * 1000 });
    
    // Wait for "Loaded ... token transactions from server" console message
    await page.waitForEvent('console', {
      predicate: (msg) => msg.text().includes('token transactions from server'),
      timeout: 120_000
    });
    
    // Now wait for progress bar to disappear (may already be hidden)
    try {
      await progressbar.waitFor({ state: 'hidden', timeout: 10 * 1000 });
    } catch {
      // Already hidden
    }
    
    // Wait for async storage writes to complete
    await page.waitForTimeout(1000);
    
    await pause500ifRecordingVideo(page);
    
    // Navigate to Year report AFTER data is loaded
    await page.getByRole('link', { name: 'Year report' }).click();
    await pause500ifRecordingVideo(page);

    // Wait for year report table to load
    await page.locator('.dailybalancerow_accountchange').first().waitFor({ state: 'visible', timeout: 30_000 });

    // Select year 2024 where intents tokens are used
    await page.locator('select#yearselect').selectOption('2024');
    await pause500ifRecordingVideo(page);

    // Select fungible token dropdown and choose BTC
    const ftDropdown = page.locator('select#tokenselect');
    await ftDropdown.waitFor({ state: 'visible', timeout: 10_000 });
    
    // Check that BTC is available in the dropdown
    const btcOption = ftDropdown.locator('option', { hasText: 'BTC' });
    await expect(btcOption).toBeAttached({ timeout: 10_000 });
    
    // Select BTC and verify daily balances are shown
    await ftDropdown.selectOption('BTC');
    await pause500ifRecordingVideo(page);
    
    // Wait for the table to update and verify we have balance data
    await page.waitForTimeout(500);
    const btcBalanceRows = page.locator('#dailybalancestable .dailybalancerow_totalbalance');
    await expect(btcBalanceRows.first()).toBeVisible({ timeout: 10_000 });
    
    // Verify the balance column has numeric values (not empty)
    const btcFirstBalance = await btcBalanceRows.first().textContent();
    expect(btcFirstBalance).toBeTruthy();
    expect(parseFloat(btcFirstBalance)).toBeGreaterThanOrEqual(0);

    // Now check for ETH
    const ethOption = ftDropdown.locator('option', { hasText: 'ETH' });
    await expect(ethOption).toBeAttached({ timeout: 5_000 });
    
    // Select ETH and verify daily balances are shown
    await ftDropdown.selectOption('ETH');
    await pause500ifRecordingVideo(page);
    
    // Wait for the table to update
    await page.waitForTimeout(500);
    const ethBalanceRows = page.locator('#dailybalancestable .dailybalancerow_totalbalance');
    await expect(ethBalanceRows.first()).toBeVisible({ timeout: 10_000 });
    
    // Verify the balance column has numeric values
    const ethFirstBalance = await ethBalanceRows.first().textContent();
    expect(ethFirstBalance).toBeTruthy();
    expect(parseFloat(ethFirstBalance)).toBeGreaterThanOrEqual(0);

    await pause500ifRecordingVideo(page);
  });
});
