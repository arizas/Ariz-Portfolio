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

Only if the web4 contract itself must change (e.g. repoint `body_url`): edit
`../ariz-gateway/contract/src/web4/handler.rs`, then
`cd ../ariz-gateway/contract && cargo near build non-reproducible-wasm` and
`near contract deploy arizportfolio.near use-file target/near/ariz_gateway.wasm without-init-call network-config mainnet sign-with-keychain send`.
Confirm the wasm size and the mainnet deploy first.
