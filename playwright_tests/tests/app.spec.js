import { test, expect } from "@playwright/test";
import { pause500ifRecordingVideo } from "../util/videorecording.js";

test("should open app", async ({ page }) => {
    await page.goto(
      "/"
    );
    await pause500ifRecordingVideo(page);
    const header = await page.getByRole('link', { name: 'NEAR account report' });
  
    await expect(header).toContainText("NEAR account report");
  });
  
  test("should open accounts page, add account, and load data", async ({ page }) => {
    await page.goto(
      "/"
    );
    await page.route("https://api.nearblocks.io/v1/account/arizportfolio.near/txns?page=2&per_page=25&order=desc", async(route) => {
        route.fulfill({json: {
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
  
    await page.getByRole('button', { name: 'load data' }).click();
    const progressbar = await page.locator('progress-bar');
    await progressbar.waitFor({ state: 'visible', timeout: 10 * 1000 });
    await progressbar.waitFor({ state: 'hidden', timeout: 60 * 1000 });
  
    await pause500ifRecordingVideo(page);
    await page.getByRole('link', { name: 'Year report' }).click();
    await pause500ifRecordingVideo(page);
  
    await page.locator('.dailybalancerow_accountchange').first().waitFor({ 'state': 'visible' });
  
    await page.locator('select#yearselect').selectOption('2021');
    await pause500ifRecordingVideo(page);
  
    await expect(await page.getByRole('cell', { name: '-12-31' })).toContainText('2021-12-31');
    await pause500ifRecordingVideo(page);
  });
  