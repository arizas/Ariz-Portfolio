import { test, expect } from "@playwright/test";
import { pause500ifRecordingVideo } from "../util/videorecording.js";

// The Storage page now authenticates with the signed-in NEAR account (NEP-413)
// and pushes to the user's repo on the Ariz gateway git server — there is no
// access-key / remote-URL field any more. This smoke test verifies the new UI
// replaced the old inputs. The full push/clone round-trip against the gateway
// (which needs a wallet + the deployed gateway git server) is covered separately.
test("storage page shows the gateway git UI (no legacy key/url inputs)", async ({ page }) => {
  await page.goto("http://localhost:8081");

  await page.getByRole('link', { name: 'Storage' }).click();
  await pause500ifRecordingVideo(page);

  // New controls are present (locators pierce the open shadow root).
  await expect(page.locator('#syncbutton')).toBeVisible();
  await expect(page.locator('#copyclonebutton')).toBeVisible();
  await expect(page.locator('#copyconfigbutton')).toBeVisible();
  await expect(page.locator('#gatewayaccountspan')).toBeVisible();
  await expect(page.locator('#downloadzipbutton')).toBeVisible();

  // Encrypted sync controls (issue #76) are present; the opt-in defaults to off.
  await expect(page.locator('#enableencryptedsyncbutton')).toBeVisible();
  await expect(page.locator('#exportkeybutton')).toBeVisible();
  await expect(page.locator('#importkeybutton')).toBeVisible();
  await expect(page.locator('#copyegitclonebutton')).toBeVisible();
  await expect(page.locator('#encryptedsyncstatus')).toHaveText('disabled');

  // Legacy inputs are gone.
  await expect(page.locator('#wasmgitaccesskey')).toHaveCount(0);
  await expect(page.locator('#remoterepo')).toHaveCount(0);
  await pause500ifRecordingVideo(page);
});

// The dist build must inline every worker as a blob (rollup.config.js). A
// worker URL that survives into the single-file bundle resolves against the
// page origin at runtime, where the SPA fallback answers with index.html — a
// text/html "module script" that kills the worker (this broke the git-worker
// restart in production once). app.js legitimately keeps a bare
// import.meta.url for routing, so assert specifically on worker-URL patterns.
test("the dist bundle contains no unresolved worker URLs", async ({ request }) => {
  const html = await (await request.get("http://localhost:8081/")).text();
  expect(html).not.toMatch(/new URL\([^)]*import\.meta\.url/);
});
