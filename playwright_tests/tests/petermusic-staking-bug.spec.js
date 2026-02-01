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

  // BUG FIXED: Previously showed ~1000 NEAR instead of ~0.2 NEAR
  // The fix: API now returns correct amount field for snapshots (0 for no-change entries)
  // and client uses API's amount directly as earnings instead of recalculating
  // Expected: ~0.4 NEAR (actual staking rewards for Aug 30)
  expect(rewardValue, 'Staking reward should be less than 10 NEAR').toBeLessThan(10);
  expect(rewardValue, 'Staking reward should be greater than 0').toBeGreaterThan(0);

  // Check consistency across Aug 24-30 period
  // Previously there was a bug where staking change showed -999,878 on Aug 25
  // because aurora.pool.near data was missing for that period
  console.log('\nChecking staking balance consistency for Aug 24-30...');

  const datesToCheck = ['2025-08-24', '2025-08-25', '2025-08-26', '2025-08-27', '2025-08-28', '2025-08-29', '2025-08-30'];
  const stakingData = {};

  for (const date of datesToCheck) {
    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const dateCell = await row.locator('.dailybalancerow_datetime').textContent();
      if (dateCell?.trim() === date) {
        const stakingBalanceCell = await row.locator('.dailybalancerow_stakingbalance');
        const stakingChangeCell = await row.locator('.dailybalancerow_stakingchange');
        const stakingRewardCell = await row.locator('.dailybalancerow_stakingreward');

        const balanceText = (await stakingBalanceCell.textContent()).trim().replace(/\s/g, '').replace(/,/g, '');
        const changeText = (await stakingChangeCell.textContent()).trim().replace(/\s/g, '').replace(/,/g, '');
        const rewardText = (await stakingRewardCell.textContent()).trim().replace(/\s/g, '').replace(/,/g, '');

        stakingData[date] = {
          balance: parseFloat(balanceText) || 0,
          change: parseFloat(changeText) || 0,
          reward: parseFloat(rewardText) || 0
        };

        console.log(`${date}: balance=${stakingData[date].balance.toFixed(0)}, change=${stakingData[date].change.toFixed(3)}, reward=${stakingData[date].reward.toFixed(3)}`);
        break;
      }
    }
  }

  // Verify no huge negative changes (the -999,878 bug)
  for (const date of datesToCheck) {
    if (stakingData[date]) {
      expect(
        stakingData[date].change,
        `${date} staking change should not be a huge negative (was -999,878 before fix)`
      ).toBeGreaterThan(-100);  // Allow small negative changes but not -999,878
    }
  }

  // Verify staking rewards are reasonable for all days
  for (const date of datesToCheck) {
    if (stakingData[date]) {
      expect(
        stakingData[date].reward,
        `${date} staking reward should be less than 10 NEAR`
      ).toBeLessThan(10);
    }
  }

  // Verify Aug 24 has the deposit reflected (balance should be higher than Aug 23 if we had that data)
  expect(stakingData['2025-08-24']?.balance, 'Aug 24 should have staking balance').toBeGreaterThan(0);

  // Verify balance consistency - no sudden drops of 1000 NEAR between consecutive days
  for (let i = 1; i < datesToCheck.length; i++) {
    const prevDate = datesToCheck[i - 1];
    const currDate = datesToCheck[i];
    if (stakingData[prevDate] && stakingData[currDate]) {
      const balanceDiff = stakingData[currDate].balance - stakingData[prevDate].balance;
      // Allow for the Aug 30 drop when aurora.pool.near was unstaked (~1000 NEAR)
      // but on other days, the change should be small (just rewards)
      if (currDate !== '2025-08-30') {
        expect(
          Math.abs(balanceDiff),
          `Balance change from ${prevDate} to ${currDate} should be small (was ~999,878 before fix)`
        ).toBeLessThan(100);
      }
    }
  }

  console.log('\nAll consistency checks passed!');
});

