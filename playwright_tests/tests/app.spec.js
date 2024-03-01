import { test, expect } from "@playwright/test";

test("should open app", async ({ page }) => {
  await page.goto(
    "/arizas.near/widget/account_report"
  );
  expect(await page.frameLocator('iframe').getByRole('link', { name: 'NEAR account report' })).toContainText("NEAR account report");
});
test("should open accounts page, add account, and load data", async ({ page }) => {
  let isVideoRecorded = (await page.video()) ? true : false;
  const pause500ifRecordingVideo = async () => {
    if (isVideoRecorded) {
      await page.waitForTimeout(500);
    }
  };

  await page.goto(
    "/arizas.near/widget/account_report"
  );
  await page.frameLocator('iframe').getByRole('link', { name: 'Accounts' }).click();
  await pause500ifRecordingVideo();

  await page.frameLocator('iframe').getByRole('button', { name: 'Add account' }).click();
  await pause500ifRecordingVideo();

  await page.frameLocator('iframe').getByRole('textbox').fill('petermusic.near');
  await pause500ifRecordingVideo();

  await page.frameLocator('iframe').getByRole('button', { name: 'load data' }).click();
  const progressbar = await page.frameLocator('iframe').locator('progress-bar');
  await progressbar.waitFor({ state: 'visible', timeout: 10 * 1000 });
  await progressbar.waitFor({ state: 'hidden', timeout: 60 * 1000 });

  await pause500ifRecordingVideo();
  await page.frameLocator('iframe').getByRole('link', { name: 'Year report' }).click();
  await pause500ifRecordingVideo();

  await page.frameLocator('iframe').locator('.dailybalancerow_accountchange').first().waitFor({ 'state': 'visible' });

  await page.frameLocator('iframe').locator('select#yearselect').selectOption('2021');
  await pause500ifRecordingVideo();

  expect(await page.frameLocator('iframe').getByRole('cell', { name: '-12-31' })).toContainText('2021-12-31');
  await pause500ifRecordingVideo();
});