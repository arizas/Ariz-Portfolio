import { test, expect } from "@playwright/test";
import { readdirSync } from "node:fs";
import { pause500ifRecordingVideo } from "../util/videorecording.js";

// The Storage page syncs end-to-end ENCRYPTED only (plaintext /git hosting is
// retired): Synchronize goes through the egit service worker, the master key
// is wallet-unlocked, and the CLI path is git-remote-egit. This smoke test
// verifies the encrypted-only UI in the dist bundle.
test("storage page shows the encrypted-only sync UI", async ({ page }) => {
  await page.goto("http://localhost:8081");

  await page.getByRole('link', { name: 'Storage' }).click();
  await pause500ifRecordingVideo(page);

  // Encrypted sync controls (locators pierce the open shadow root).
  await expect(page.locator('#syncbutton')).toBeVisible();
  await expect(page.locator('#downloadzipbutton')).toBeVisible();
  await expect(page.locator('#gatewayaccountspan')).toBeVisible();
  await expect(page.locator('#exportkeybutton')).toBeVisible();
  await expect(page.locator('#importkeybutton')).toBeVisible();
  await expect(page.locator('#copyegitclonebutton')).toBeVisible();

  // Plaintext-era and legacy controls are gone.
  await expect(page.locator('#copyclonebutton')).toHaveCount(0);
  await expect(page.locator('#copyconfigbutton')).toHaveCount(0);
  await expect(page.locator('#enableencryptedsyncbutton')).toHaveCount(0);
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

// The gateway deploy ships ONLY dist/index.html, so the bundle must stay fully
// self-contained. A dynamic import() anywhere in the app makes rollup
// code-split into extra hashed chunks — index.html then references files that
// 404 in production, and the inline-js step silently no-ops (it looks for
// dist/app.js, which the split renames). This caught a real regression.
test("the dist build is a single self-contained index.html", () => {
  const files = readdirSync(new URL("../../dist", import.meta.url));
  expect(files).toEqual(["index.html"]);
});
