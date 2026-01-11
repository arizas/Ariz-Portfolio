import { test, expect } from "@playwright/test";

test("should show correct staking reward for petermusic.near on Aug 30 2025", async ({ page }) => {
  test.setTimeout(180_000);

  // Capture console messages
  const consoleLogs = [];
  page.on('console', msg => {
    consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
  });

  await page.goto("/");

  // Go to accounts page and add petermusic.near
  await page.getByRole('link', { name: 'Accounts' }).click();
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByRole('textbox').fill('petermusic.near');

  // Load data from server
  console.log('Loading data from server...');
  await page.getByRole('button', { name: 'load from server' }).click();

  // Wait for data to load - look for console message indicating success
  await page.waitForTimeout(30000);  // Wait up to 30 seconds for data

  // Print DEBUG logs
  console.log('DEBUG logs:');
  consoleLogs
    .filter(log => log.includes('DEBUG'))
    .forEach(log => console.log(log));

  console.log('\nConsole logs (staking/accounting related):');
  consoleLogs
    .filter(log => log.includes('staking') || log.includes('Staking') ||
                   log.includes('accounting') || log.includes('entries') ||
                   log.includes('deposit') || log.includes('earning'))
    .slice(-15)
    .forEach(log => console.log(log));

  // Go to Year report
  console.log('Going to Year report...');
  await page.getByRole('link', { name: 'Year report' }).click();

  // Wait for table to populate with non-zero data
  console.log('Waiting for year report data...');
  await page.waitForTimeout(5000);

  // Select 2025 and August (to see Aug 30)
  console.log('Selecting date range...');
  await page.getByLabel('Select start year').selectOption("2025");
  await page.waitForTimeout(1000);
  await page.getByLabel('Select start month').selectOption("August");
  await page.waitForTimeout(1000);

  const numberOfMonths = await page.getByLabel('Number of months');
  await numberOfMonths.focus();
  await numberOfMonths.fill("2");  // Aug + Sep
  await numberOfMonths.blur();

  // Wait for table to update
  await page.waitForTimeout(3000);

  // Debug: print what's in the table
  const tableText = await page.locator("#dailybalancestable").textContent();
  console.log('Table content (first 500 chars):', tableText?.substring(0, 500));

  // Find the row for Aug 30, 2025
  const rows = await page.locator("#dailybalancestable tr");
  const rowCount = await rows.count();

  console.log(`Found ${rowCount} rows`);

  // Log first 5 and last 5 dates
  for (let i = 0; i < Math.min(5, rowCount); i++) {
    const dateText = await rows.nth(i).locator('.dailybalancerow_datetime').textContent();
    console.log(`Row ${i}: ${dateText}`);
  }
  if (rowCount > 10) {
    console.log('...');
    for (let i = rowCount - 5; i < rowCount; i++) {
      const dateText = await rows.nth(i).locator('.dailybalancerow_datetime').textContent();
      console.log(`Row ${i}: ${dateText}`);
    }
  }

  let aug30Row = null;
  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);
    const dateCell = await row.locator('.dailybalancerow_datetime').textContent();
    if (dateCell?.trim() === '2025-08-30') {
      aug30Row = row;
      console.log(`Found Aug 30 row at index ${i}`);
      break;
    }
  }

  expect(aug30Row, 'Should find Aug 30, 2025 row').not.toBeNull();

  // Get the staking reward value
  const stakingRewardCell = await aug30Row.locator('.dailybalancerow_stakingreward');
  const stakingRewardText = await stakingRewardCell.textContent();

  console.log(`Aug 30 staking reward text: "${stakingRewardText}"`);

  // Parse the reward value (handle formatting with thousand separators)
  // Format could be "1,000.389" or "1 000.389" depending on locale
  // The text shows "1,000.389 " which is 1000.389 NEAR
  const cleanedReward = stakingRewardText
    .trim()
    .replace(/\s/g, '')  // Remove spaces
    .replace(/,/g, '');  // Remove commas (thousand separators when period is decimal)
  const rewardValue = parseFloat(cleanedReward);

  console.log(`Parsed reward value: ${rewardValue}`);

  // BUG VERIFIED: reward shows ~1000 NEAR instead of ~0.4 NEAR
  // This test documents the bug - it SHOULD fail until the bug is fixed
  // Expected: ~0.4 NEAR
  // Actual: ~1000.389 NEAR

  // This assertion will FAIL - documenting the bug
  expect(rewardValue, 'BUG: Staking reward shows 1000 NEAR instead of ~0.4 NEAR').toBeLessThan(10);
});

