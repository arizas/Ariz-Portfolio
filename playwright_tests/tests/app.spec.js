import { test, expect } from "@playwright/test";
import { pause500ifRecordingVideo } from "../util/videorecording.js";
import { createIndexedDBSnapshot, restoreIndexedDBSnapshot } from "../util/indexeddb.js";

test("should open app", async ({ page }) => {
  await page.goto(
    "/"
  );
  await pause500ifRecordingVideo(page);
  const header = await page.getByRole('link', { name: 'NEAR account report' });

  await expect(header).toContainText("NEAR account report");
});

test("should open accounts page, add account, and load data", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(
    "/"
  );
  await page.route("https://api.nearblocks.io/v1/account/arizportfolio.near/txns?page=2&per_page=25&order=desc", async (route) => {
    route.fulfill({
      json: {
        "cursor": "6999325132",
        "txns": []
      }
    });
  });
  await page.getByRole('link', { name: 'Accounts' }).click();
  await pause500ifRecordingVideo(page);

  await page.getByRole('button', { name: 'Add account' }).click();
  await pause500ifRecordingVideo(page);

  await page.getByRole('textbox').fill('arizportfolio.near');
  await pause500ifRecordingVideo(page);

  await page.getByRole('button', { name: 'load from server' }).click();
  // Wait for progress bar to appear and disappear, or just wait if data loads too fast (cached)
  const progressbar = await page.locator('progress-bar');
  try {
    await progressbar.waitFor({ state: 'visible', timeout: 2 * 1000 });
    await progressbar.waitFor({ state: 'hidden', timeout: 60 * 1000 });
  } catch {
    // Progress bar may have appeared and disappeared too quickly if data was cached
    await page.waitForTimeout(1000);
  }

  await pause500ifRecordingVideo(page);
  await page.getByRole('link', { name: 'Year report' }).click();
  await pause500ifRecordingVideo(page);

  await page.locator('.dailybalancerow_accountchange').first().waitFor({ 'state': 'visible' });

  await page.locator('select#yearselect').selectOption('2021');
  await pause500ifRecordingVideo(page);

  await expect(await page.getByRole('cell', { name: '-12-31' })).toContainText('2021-12-31');
  await pause500ifRecordingVideo(page);
  // await createIndexedDBSnapshot(page);
});

test('should create year report', async ({page, context}) => {
  await page.goto(
    "/"
  );
  
  await restoreIndexedDBSnapshot(page, 'testdata/indexeddbsnapshot-1.json');
  await page.reload();
  await page.getByRole('link', { name: 'Year report' }).click();
  await page.getByLabel('Select start year').selectOption("2024");
  await page.getByLabel('Select start month').selectOption("June");
  const numberOfMonths = await page.getByLabel('Number of months')
  await numberOfMonths.focus();
  await numberOfMonths.fill("2");
  await numberOfMonths.blur();

  await page.waitForTimeout(500);
  await expect(await await page.locator("#dailybalancestable tr").first().locator('.dailybalancerow_datetime').innerText()).toBe('2024-07-31');
  await expect(await await page.locator("#dailybalancestable tr").first().locator('.dailybalancerow_totalbalance').innerText()).toBe('3.288');

  const lastRow = await page.locator("#dailybalancestable tr").last();
  await expect(await lastRow.locator('.dailybalancerow_datetime').innerText()).toBe('2024-06-01');
  await expect(await lastRow.locator('.dailybalancerow_totalbalance').innerText()).toBe('0');
  await page.getByRole('button', { name: 'Print (all tokens)' }).click();
  await page.waitForTimeout(500);
  await expect(await context.pages().length).toBe(2);

  const reportPage = await context.pages()[1];
  await reportPage.bringToFront();

  await expect(await await reportPage.locator("#dailybalancestable tr").first().locator('.dailybalancerow_datetime').innerText()).toBe('2024-07-31');
  await expect(await await reportPage.locator("#dailybalancestable tr").first().locator('.dailybalancerow_totalbalance').innerText()).toBe('3.288');

  await expect(await reportPage.locator("#dailybalancestable tr").last().locator('.dailybalancerow_datetime').innerText()).toBe('2024-06-01');
  await expect(await reportPage.locator("#dailybalancestable tr").last().locator('.dailybalancerow_totalbalance').innerText()).toBe('0');
});
