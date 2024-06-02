import { test, expect } from "@playwright/test";
import { pause500ifRecordingVideo } from "../util/videorecording.js";

test("should clone wasm-git repository when providing access key", async ({ page }) => {
  await page.goto(
    "http://localhost:8081"
  );

  await pause500ifRecordingVideo(page);
  await page.getByRole('link', { name: 'Storage' }).click();
  await pause500ifRecordingVideo(page);
  const wasmgitaccesskeyinput = await page.locator('#wasmgitaccesskey');
  await wasmgitaccesskeyinput.fill('test.near:3XV8JxA8VEngikCBXEqphLbymgK3NyMgAptDdBQURy5J');
  await wasmgitaccesskeyinput.blur();
  await expect(await page.locator('#wasmgitaccountspan')).toHaveText('test.near');

  await pause500ifRecordingVideo(page);
  await page.locator('#remoterepo').fill('http://localhost:15000/testrepo');
  await pause500ifRecordingVideo(page);

  let authorizationHeader;
  await page.route('http://localhost:15000/**/*', async(route) => {
    authorizationHeader = route.request().headers().authorization;
    route.continue();
  });

  await page.locator('#syncbutton').click();
  await pause500ifRecordingVideo(page);

  const accessTokenParts = authorizationHeader.split(' ')[1].split('.');
  const accessTokenMessageObj = JSON.parse(Buffer.from(accessTokenParts[0], 'base64'));
  expect(accessTokenMessageObj.accountId).toEqual('test.near');
});