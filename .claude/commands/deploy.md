Build the Ariz Portfolio app and deploy it to the ariz-gateway NEAR contract.

The ariz-gateway repo (https://github.com/ArizHQ/ariz-gateway) should be cloned as a sibling directory to this repo.

## Steps

1. **Build the app bundle** (in this repo):
   ```
   yarn dist
   ```
   This runs rollup to bundle `public_html/index.html` into a single `dist/index.html` file with all JS inlined.

2. **Base64-encode and copy to contract** (ariz-gateway is in `../ariz-gateway`):
   ```
   base64 -i dist/index.html -o ../ariz-gateway/contract/src/web4/index.html.base64
   ```

3. **Build the NEAR contract**:
   ```
   cd ../ariz-gateway/contract && cargo near build non-reproducible-wasm
   ```
   This produces `target/near/ariz_gateway.wasm`.

4. **Deploy the contract**:
   ```
   cd ../ariz-gateway/contract && near contract deploy arizportfolio.near use-file target/near/ariz_gateway.wasm without-init-call network-config mainnet sign-with-keychain send
   ```

5. **Verify** by checking https://arizportfolio.near.page in a browser.

IMPORTANT: Always ask for confirmation before step 4 (deploy). Show the wasm file size and confirm the user wants to deploy to mainnet.
