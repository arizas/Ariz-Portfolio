import { test, expect } from "@playwright/test";
import { pause500ifRecordingVideo } from "../util/videorecording.js";

test("should clone wasm-git repository when providing access key", async ({ page }) => {
  await page.goto(
    "http://localhost:8081"
  );

  await page.getByRole('link', { name: 'Accounts' }).click();
  await pause500ifRecordingVideo(page);

  await page.getByRole('button', { name: 'Add account' }).click();
  await pause500ifRecordingVideo(page);

  await page.getByRole('textbox').fill('petermusic.near');
  await pause500ifRecordingVideo(page);

  const configureStorage = async () => {
    await pause500ifRecordingVideo(page);
    await page.getByRole('link', { name: 'Storage' }).click();
    await pause500ifRecordingVideo(page);
    const wasmgitaccesskeyinput = await page.locator('#wasmgitaccesskey');
    await wasmgitaccesskeyinput.fill('test.near:3XV8JxA8VEngikCBXEqphLbymgK3NyMgAptDdBQURy5J');
    await wasmgitaccesskeyinput.blur();
    await expect(await page.locator('#wasmgitaccountspan')).toHaveText('test.near');

    await pause500ifRecordingVideo(page);
    await page.locator('#remoterepo').fill('http://localhost:15000/testrepo.git');
    await pause500ifRecordingVideo(page);
  };

  await configureStorage();
  await page.locator('#syncbutton').click();

  await page.waitForTimeout(1000);
  await expect(await page.locator('progress-bar')).not.toBeVisible();

  await page.locator("#deletelocaldatabutton").click();

  await page.waitForTimeout(1000);

  await page.goto(
    "http://localhost:8081"
  );

  await page.getByRole('link', { name: 'Accounts' }).click();
  await pause500ifRecordingVideo(page);
  await expect(page.getByRole('textbox')).not.toBeAttached();

  await configureStorage();
  await page.locator('#syncbutton').click();

  await page.waitForTimeout(1000);
  await expect(await page.locator('progress-bar')).not.toBeVisible();

  await page.getByRole('link', { name: 'Accounts' }).
  click();
  await pause500ifRecordingVideo(page);
  await expect(page.getByRole('textbox')).toHaveValue('petermusic.near');
  await pause500ifRecordingVideo(page);
});