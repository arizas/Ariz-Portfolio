import { test, expect } from '@playwright/test';

async function pause500ifRecordingVideo(page) {
  const isRecording = process.env.PWVIDEO === '1';
  if (isRecording) {
    await page.waitForTimeout(500);
  }
}

test.describe('Single Transaction Fetch', () => {
  test('should fetch one transaction for webassemblymusic-treasury.sputnik-dao.near', async ({ page }) => {
    test.setTimeout(300_000); // 5 minutes timeout

    // Set up console logging to capture all messages
    const consoleLogs = [];
    page.on('console', msg => {
      const text = msg.text();
      console.log('Console:', text);
      consoleLogs.push(text);
    });

    // Navigate to the app
    await page.goto('/');

    // Go to accounts page
    await page.getByRole('link', { name: 'Accounts' }).click();
    await pause500ifRecordingVideo(page);

    // Add the specific account
    await page.getByRole('button', { name: 'Add account' }).click();
    await pause500ifRecordingVideo(page);

    await page.getByRole('textbox').fill('webassemblymusic-treasury.sputnik-dao.near');
    await pause500ifRecordingVideo(page);

    // Start loading data
    console.log('Starting to load data for webassemblymusic-treasury.sputnik-dao.near');
    await page.getByRole('button', { name: 'load data' }).click();

    // Wait for progress bar to appear
    const progressbar = await page.locator('progress-bar');
    await progressbar.waitFor({ state: 'visible', timeout: 10 * 1000 });
    console.log('Progress bar appeared');

    // Wait for the success message to appear in console logs
    let foundTransaction = false;
    const startTime = Date.now();
    const timeout = 180 * 1000; // 3 minutes

    while (!foundTransaction && (Date.now() - startTime) < timeout) {
      // Check if we found the transaction
      foundTransaction = consoleLogs.some(log =>
        log.includes('Found transaction 1/1') ||
        log.includes('Found 1 new NEAR transactions')
      );

      if (!foundTransaction) {
        // Wait a bit before checking again
        await page.waitForTimeout(500);
      }
    }

    if (!foundTransaction) {
      console.log('Timeout waiting for transaction. Current logs:', consoleLogs);
      throw new Error('Transaction not found within timeout');
    }

    console.log('Transaction found!');

    // Give a moment for all console logs to be captured
    await page.waitForTimeout(1000);

    // Check that we found exactly one transaction
    const foundTransactionLog = consoleLogs.find(log =>
      log.includes('Found transaction 1/1')
    );
    expect(foundTransactionLog).toBeTruthy();
    console.log('Found transaction log:', foundTransactionLog);

    // Check that we have exactly 1 new NEAR transaction
    const nearTransactionsLog = consoleLogs.find(log =>
      log.includes('Found 1 new NEAR transactions')
    );
    expect(nearTransactionsLog).toBeTruthy();
    console.log('NEAR transactions log:', nearTransactionsLog);

    // IMPORTANT: Check that no error alert appears
    // The error alert would contain "Error fetching data" with a message about method_name
    const errorLogs = consoleLogs.filter(log =>
      log.includes('Error:') || log.includes('TypeError')
    );
    if (errorLogs.length > 0) {
      console.log('ERROR: Found error logs that should not appear:', errorLogs);
    }
    expect(errorLogs).toHaveLength(0); // Should have no error logs

    // Also check that the error modal is not visible
    const errorModal = page.locator('common-modal');
    await expect(errorModal).not.toBeVisible();

    // Extract block information from logs
    const searchingBlocksLogs = consoleLogs.filter(log =>
      log.includes('Searching blocks')
    );
    console.log('Block search logs:', searchingBlocksLogs);

    // Look for the transaction details in the logs
    const balanceChangeLogs = consoleLogs.filter(log =>
      log.includes('balance change') || log.includes('transaction found')
    );
    console.log('Balance change logs:', balanceChangeLogs);

    // Navigate to Year report to see if transaction appears
    await page.getByRole('link', { name: 'Year report' }).click();
    await pause500ifRecordingVideo(page);

    // Check if there's at least one transaction row in the report
    const transactionRows = await page.locator('tbody tr').count();
    console.log('Number of transaction rows in report:', transactionRows);
    expect(transactionRows).toBeGreaterThanOrEqual(1);

    // Print all console logs for debugging
    console.log('\n=== All Console Logs ===');
    consoleLogs.forEach(log => console.log(log));
    console.log('=== End Console Logs ===\n');
  });

  test.skip('should match Node.js results', async ({ page }) => {
    test.setTimeout(120_000);
    // Skipping this test as it requires Node.js child_process which isn't available in playwright browser context

    // Now run the web version
    const consoleLogs = [];
    page.on('console', msg => {
      consoleLogs.push(msg.text());
    });

    await page.goto('/');
    await page.getByRole('link', { name: 'Accounts' }).click();
    await page.getByRole('button', { name: 'Add account' }).click();
    await page.getByRole('textbox').fill('webassemblymusic-treasury.sputnik-dao.near');
    await page.getByRole('button', { name: 'load data' }).click();

    const progressbar = await page.locator('progress-bar');
    await progressbar.waitFor({ state: 'visible', timeout: 10 * 1000 });
    await progressbar.waitFor({ state: 'hidden', timeout: 60 * 1000 });
    await page.waitForTimeout(2000);

    // Extract block numbers from web logs
    const webBlockLogs = consoleLogs.filter(log =>
      log.includes('block') && log.match(/\d{7,}/)
    );
    console.log('Web block logs:', webBlockLogs);

    // Check if we found a transaction
    const foundTransaction = consoleLogs.some(log =>
      log.includes('Found transaction 1/1')
    );
    expect(foundTransaction).toBeTruthy();

    // If we have both results, compare them
    if (nodeBlockNumber && webBlockLogs.length > 0) {
      console.log('Comparing Node.js and web results...');
      console.log('Node.js block:', nodeBlockNumber);
      console.log('Web blocks found in logs:', webBlockLogs);
    }
  });
});