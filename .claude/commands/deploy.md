Build the Ariz Portfolio app and deploy it as the live frontend at https://arizportfolio.near.page.

The ariz-gateway repo (https://github.com/ArizHQ/ariz-gateway) should be cloned as a sibling directory to this repo.

## How serving works (since the web4 bodyUrl switch)

The `arizportfolio.near` web4 contract returns `Web4Response::BodyUrl` pointing at
`https://arizgateway.fly.dev/`, which serves the bundle from `server/public/index.html`.
So **the frontend is just a file on the gateway** — updating it needs only a gateway
deploy (push to `main` → Fly auto-deploys), **no contract redeploy**. The contract is
deployed once and only needs touching if the gateway URL or web4 behavior changes.

## Steps

1. **Build the app bundle** (in this repo):
   ```
   yarn dist
   ```
   Rollup bundles `public_html/index.html` into a single self-contained `dist/index.html`.

2. **Copy the bundle into the gateway** (ariz-gateway is in `../ariz-gateway`):
   ```
   cp dist/index.html ../ariz-gateway/server/public/index.html
   ```

3. **Commit + push** in ariz-gateway (a PR, or directly to `main`) — pushing to `main`
   triggers the Fly deploy that serves the new bundle:
   ```
   cd ../ariz-gateway && git add server/public/index.html && git commit -m "frontend: update bundle" && git push
   ```

4. **Verify** at https://arizportfolio.near.page (hard-refresh). web4 may cache the
   fetched body briefly, so allow a short propagation delay.

IMPORTANT: pushing to `ariz-gateway` `main` auto-deploys to production via Fly — confirm before pushing.

## Contract (rare)

`arizportfolio.near` runs a minimal ~450-byte WAT contract whose `web4_get` returns
a **path-aware** `bodyUrl` (`https://arizgateway.fly.dev<path>`), so per-path assets
like `/sw.js` are served same-origin with the right MIME type while SPA routes hit
the gateway's index.html fallback (it replaced the old 123 KB Rust contract, freeing
~1.2 NEAR). You only need to redeploy it to repoint the gateway URL.

1. Rebuild — regenerates `web4contract/web4contract.wat` + `.wasm` (both gitignored;
   `web4contract.wat.js` is the source). Override the URL with `WEB4_BODY_URL`:
   ```
   node web4contract/web4contract.wat.js
   node --test web4contract/web4contract.test.mjs   # mocked NEAR host — must pass before deploying
   ```
2. Deploy (confirm the wasm size and the mainnet deploy first):
   ```
   near contract deploy arizportfolio.near use-file web4contract/web4contract.wasm without-init-call network-config mainnet sign-with-keychain send
   ```

The retired Rust source still lives in `../ariz-gateway/contract` if the
token-registry methods ever need restoring.
