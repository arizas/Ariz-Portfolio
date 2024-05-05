import { test, expect } from "@playwright/test";
import { pause500ifRecordingVideo } from "../util/videorecording.js";
import { createServer } from 'http';

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
  await page.locator('#remoterepo').fill('http://localhost:15000/test');
  await pause500ifRecordingVideo(page);

  let requestPromiseResolve;
  let requestPromise = new Promise(resolve => requestPromiseResolve = resolve);

  const mockGitServer = await createServer((req, res) => {
    if (req.method == 'OPTIONS') {
      res.writeHead(200, { 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Origin': '*' });
      res.end();
    } else {
      requestPromiseResolve(req);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Nothing here');
    }
  });
  await new Promise(resolve => mockGitServer.listen(15000, () => resolve()));
  await page.locator('#syncbutton').click();
  await pause500ifRecordingVideo(page);
  const request = await requestPromise;
  expect(request.url).toEqual('/test/info/refs?service=git-upload-pack');
  const accessTokenParts = request.headers.authorization.split(' ')[1].split('.');
  const accessTokenMessageObj = JSON.parse(Buffer.from(accessTokenParts[0], 'base64'));
  expect(accessTokenMessageObj.accountId).toEqual('test.near');
});