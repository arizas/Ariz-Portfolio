Ariz Portfolio
===================

A web application for getting an overview of one or multiple NEAR accounts: what you hold, how it changed, what you earned from staking, and what you gained or lost when trading, valued in the currency you choose.

**Live at**: https://arizportfolio.near.page

**Note:** Ariz Portfolio helps you prepare tax and accounting reports. It does not claim that its output complies with the rules in your jurisdiction, and it takes no responsibility for whether it does. It collects, prices and calculates according to defined, documented logic, but it can't know every rule that applies to you, and on-chain data can be incomplete or ambiguous. Review the numbers and make your own judgement: you are responsible for the final report.

# What it does

- **Portfolio**: holdings across all your accounts, split into liquid and staked, with value over time and a breakdown of where the money in a period came from.
- **Year report**: per day and per token (NEAR, fungible tokens, NEAR Intents and confidential holdings):
  - end-of-day balances
  - staking rewards
  - deposits and withdrawals
  - profit/loss on disposals (First-In-First-Out), with a day detail that shows where each profit came from
  - yearly totals, a printable version, and a custom period instead of a calendar year
- **Transactions**: every balance change per account, filterable by token.
- **Staking rewards**: per account and staking pool.
- **Counterparties**: classify who you transact with (for example as income or expense), so transfers are not all treated the same.
- **Confidential NEAR Intents**: fetch an account's confidential history by signing with that account's wallet. It is stored only in your own repository, never on the server.
- **AI assistant**: ask about your portfolio in your own words. It runs on a NEAR AI Cloud model whose confidential hardware your browser verifies first, every message is end-to-end encrypted to that hardware, and the model works through the app's own reports and small JavaScript programs that run in a sandbox in your browser. Anything that would change your data waits for your approval.

# NEAR HACKATHON: Privacy & Private AI

Built at NEAR HACKATHON (2026-10-19 to 2026-11-14), track **Privacy & Private AI**.

**The problem.** A portfolio's full transaction history is exactly the data you should not paste into a cloud AI, yet it is where an AI is most useful: "how did I do this year, and why?" Ariz Portfolio already kept that history only in your browser (and encrypted in the cloud). The hackathon work lets an AI read it without the data becoming readable to anyone else.

**What was built in the window**, judged against the baseline below:

- **Private AI assistant on NEAR AI Cloud** (`/ai-assistant`, [public_html/dataagent/](public_html/dataagent/)):
  - Sign in to NEAR AI with your NEAR wallet (one NEP-413 signature, no transaction). The browser creates an API key with a spending cap and keeps it in the browser only, so inference runs on your own NEAR AI credits and the browser talks to NEAR AI directly.
  - **Attestation checked in the browser** before any question is sent ([nearai-attestation.js](public_html/dataagent/nearai-attestation.js)): the Intel TDX quote of the model's enclave, that the report binds the model's signing key and a fresh nonce from this browser, the software it runs, and NVIDIA's signed verdict that the GPUs are in confidential mode (the GPU evidence is relayed to NVIDIA through the Ariz gateway, and the browser checks NVIDIA's signature itself). A model that does not pass is shown as not private, and the page asks for explicit consent before using it.
  - **End-to-end encryption to the enclave** ([nearai-e2ee.js](public_html/dataagent/nearai-e2ee.js)): NEAR AI's encryption protocol v2 with all fields encrypted (messages, tool definitions, tool calls and results), XChaCha20-Poly1305 to the attested key; every answer's signature by that key is checked against the exact request and response.
  - **The model writes JavaScript instead of reading raw data** ([script-sandbox.js](public_html/dataagent/script-sandbox.js)): its programs run in QuickJS compiled to WebAssembly, a fresh engine per run, with no DOM, network or storage and a 20 s limit. The only way out is `app.*`, the same read API the app's pages use ([data-api.js](public_html/dataagent/data-api.js)); only the program's output goes back to the model, encrypted.
  - **Approval for every change**: the assistant can only propose actions (add an account, fetch history, set a counterparty, …); nothing happens until the owner clicks Approve.
- **Gateway support** ([arizas/ariz-gateway](https://github.com/arizas/ariz-gateway)): the NVIDIA attestation relay ([#60](https://github.com/arizas/ariz-gateway/pull/60)) and a balances API for the assistant's balance check ([#59](https://github.com/arizas/ariz-gateway/pull/59)).
- **Hardening for running model-written code next to your data**: a Content-Security-Policy where script runs only by a per-load nonce ([#139](https://github.com/arizas/Ariz-Portfolio/pull/139)), token names always shown as text ([#138](https://github.com/arizas/Ariz-Portfolio/pull/138)), and the assistant's answers rendered without parsing markup ([#145](https://github.com/arizas/Ariz-Portfolio/pull/145)).
- Also in the window: an exclude list for unpriced tokens ([#136](https://github.com/arizas/Ariz-Portfolio/pull/136)), duplicate NEAR movements resolved against the chain ([#143](https://github.com/arizas/Ariz-Portfolio/pull/143)), retrying a failed provider call ([#145](https://github.com/arizas/Ariz-Portfolio/pull/145)), and a workaround for NEAR AI's DeepSeek provider rejecting tool results that are JSON arrays ([#146](https://github.com/arizas/Ariz-Portfolio/pull/146)).

**Diff of the hackathon work:** [pre-hackathon...hackathon-submission](https://github.com/arizas/Ariz-Portfolio/compare/pre-hackathon...hackathon-submission) (tag `pre-hackathon` = 04dd300, the last commit before 2026-10-19's announcement).

**Baseline (built before the window):** the app itself (portfolio, year report, accounting, prices), storage in an in-browser git repository with [wasm-git](https://github.com/petersalomonsen/wasm-git), end-to-end encrypted sync with [encrypted-git-storage](https://github.com/petersalomonsen/encrypted-git-storage), the Ariz gateway and the web4 hosting. These are the author's own earlier projects. The QuickJS engine is the author's [quickjs-wasm](https://github.com/petersalomonsen/quickjs-rust-near) package; version 0.0.6, which frees the result of each host call so a script can page through a dataset of any size, was published in the window. The code was written with the help of Claude Code.

**How NEAR is used:** NEAR AI Cloud for private inference in TEEs (Intel TDX and NVIDIA confidential GPUs), with NEAR wallet sign-in to NEAR AI; NEP-413 signed messages for the Ariz gateway; the app is served from the web4 contract `arizportfolio.near`; the data itself is NEAR accounts, staking and NEAR Intents history.

## Try it

**In the live app** (https://arizportfolio.near.page):

1. Open **AI assistant**. Click **Connect with wallet** and sign the message with a NEAR wallet: the page says *Connected to NEAR AI as \<your account\>*. This uses your NEAR AI account's credits; add them at cloud.near.ai if it says there are none.
2. The model is **Qwen 3.6 35B A3B FP8** (the default). Within a few seconds the box turns green, *Private. … runs in confidential hardware that this browser verified*; open **What this browser checked** to see each check (Intel, nonce binding, software, NVIDIA). The GPU check goes through the Ariz gateway, which asks you to sign in with your wallet (a signature, no cost). Choose a model NEAR AI runs at Chutes or Tinfoil (for example Kimi K3) and it says *Not verified* instead, with a checkbox to accept that.
3. Ask *What does my data cover, and is anything stale, wrong or missing?* With no accounts added, there is little to find. To ask about a real portfolio, add an account on **Accounts** and click **load from server** first; downloading history uses Ariz credits: on the **Ariz credits** page, click **Buy 3 ARIZ for 0.5 NEAR**, then authorise the gateway to deduct them. **Judges who would rather not buy any can ask us for ARIZ:** [open an issue](https://github.com/arizas/Ariz-Portfolio/issues/new?title=ARIZ%20for%20judging) with your NEAR account, or DM [@HelloAriz](https://x.com/HelloAriz) on X, and we will send them.
4. Ask *How did my portfolio do in NOK since 1 January 2026? Split the change into money I put in or took out, staking rewards, and market movement. Then write a script that ranks my holdings by result since then (unrealized plus realized) and name the best three and the worst three.* Each step the model took appears above the answer: open **Ran run_script** to see the program it wrote and its output. In the browser's developer tools (Network), the request to `cloud-api.near.ai/v1/chat/completions` has a body of hex ciphertext where the question and tool results would be.

The model matters: of the models that verify, Qwen 3.6 35B A3B, the default, answered this question in 30-45 s with one or two scripts in our runs, while DeepSeek V4.1 Flash often explored for many steps. A model chosen earlier is remembered in the browser, so pick Qwen 3.6 in the list if another one is shown.

**Locally, with no keys or credits** (Node 20+, `yarn install`):

- `yarn test`: unit tests in a real browser, including the attestation checks against recorded NEAR AI reports ([nearai-attestation.spec.js](public_html/dataagent/nearai-attestation.spec.js)), the encryption and response-signature checks ([nearai-e2ee.spec.js](public_html/dataagent/nearai-e2ee.spec.js)) and the agent loop ([agent.spec.js](public_html/dataagent/agent.spec.js)). Expect all tests to pass.
- `yarn test:data-agent`: the assistant's toolkit in a headless browser on the real OPFS git worker, with a scripted model: scripts run in the QuickJS sandbox, cannot reach the network or the page, and proposed changes wait for approval. Expect `56/56 passed`.

**Demo video:** [full demo on YouTube](https://youtu.be/R-s91wwyrEg) (2:51), and the [demo post on X](https://x.com/HelloAriz/status/2121580638151041356) (2:18). The account names and amounts in the demo are disguised.

**Team:** Stian Forland and Peter Salomonsen (Ariz AS).

# How to use

1. Open the **Accounts** page and add your accounts.
2. Click **load from server** to download each account's transaction and balance history.
3. To include confidential NEAR Intents history, click the shield-lock button next to an account and sign with that account's wallet.
4. Open **Portfolio** or **Year report**. Choose the target currency in the view settings. Tokens without a price can be put on an editable exclude list.
5. Optionally, on the **Storage** page, sign in with your NEAR account and enable sync, so your data is backed up and available on other devices (see below).

The server side (history export, prices, sync) is provided by the Ariz gateway and is paid for with Ariz credits (see the **Ariz credits** page).

# How it works

**History and balances.** Each account's history comes from an accounting export service behind the Ariz gateway. The service indexes the account and returns its balance changes along with pre-computed balances, so the browser no longer reconstructs balances one transaction at a time. Confidential NEAR Intents history is fetched directly from the 1Click service with the account's own signature.

**Deposits and withdrawals.** Balance changes are added up across all the accounts you have configured, so transfers between your own accounts cancel out. Movements to and from staking pools are not counted as deposits or withdrawals, and neither is NEAR sent to your own confidential deposit address.

**Staking rewards** are derived from the staking balance series: the change in staked balance that is not explained by your own deposits or withdrawals.

**Prices** are daily prices served by the gateway. Each price records the date it comes from, and missing days are filled in when you load from the server. A swap is valued on one figure for both sides, chosen in this order: the value the swap venue reported, a stablecoin leg, the end-of-day price of the token received, and the end-of-day price of the token given. A confidential stake is treated as a swap into stNEAR.

**Profit/loss** uses First-In-First-Out: each disposal is matched against the oldest acquisitions still held.

# Technical details

This is a web application built on ECMAScript Modules, with no framework like React or Angular. It is meant to show what you can do with the HTML and JavaScript that is built into today's web browsers, without heavy frameworks or polyfills. Components are Web Components (Custom Elements), and the HTML markup is kept separate from the code (the part of Angular I always liked best). It is not as sophisticated as Angular, but it is fast enough and easy to follow, because it only uses standard browser technology.

## Storage

Your data does not live on a server. It is stored in your browser (OPFS), in a git repository provided by [wasm-git](https://github.com/petersalomonsen/wasm-git). The app keeps working offline, and you get git's synchronization (fetch, merge, push) and the full history of your changes.

Sync to the Ariz gateway is **end-to-end encrypted**. The whole repository (contents, filenames and history, including which accounts you have grouped and how you have classified counterparties) is encrypted on your device before upload, so neither the gateway operator nor the storage provider can read it. The key is unlocked with your wallet. See [docs/encrypted-storage.md](docs/encrypted-storage.md) for the design, the threat model and the known limitations. You can also clone the repository from the command line; the Storage page shows the commands.

## Bundling

The app is bundled with [rollup](rollup.config.js) into a single self-contained `dist/index.html`. That file includes the HTML templates, the JavaScript modules and the [wasm-git worker](public_html/storage/wasmgitworker.js).

```
yarn dist
```

## Deployment

`arizportfolio.near` is a [web4](https://web4.near.page/) contract that points at the Ariz gateway (https://arizgateway.fly.dev/). The gateway serves the bundle and the encrypted-sync service worker (`/sw.js`). Deploying a frontend change is a gateway deploy; the contract does not need to change:

1. `yarn dist` in this repository.
2. Copy `dist/index.html` to `ariz-gateway/server/public/index.html`.
3. If the `encrypted-git-storage` dependency changed, also refresh the gateway's committed `server/public/sw.js`.
4. Commit and push in ariz-gateway. Pushing to `main` deploys it.

See [.claude/commands/deploy.md](.claude/commands/deploy.md) for the full checklist and how to verify the live files.

## Development and tests

```
yarn serve          # dev server
yarn test           # unit tests (web-test-runner, in a real browser)
yarn test:e2e       # end-to-end tests (Playwright)
yarn test:encrypted-sync   # encrypted sync harness
```

# History

**2022: a staking reward calculator.** The project started in January 2022 as a small tool for a question every NEAR staker had: how much did I earn from staking each day, and what was it worth? It read account history from the NEAR wallet helper API, queried balances block by block, and produced a year report of daily balances, rewards, deposits/withdrawals and FIFO profit/loss. From the start, everything was stored in the browser, in a git repository through wasm-git.

**2023–2024: more sources, more tokens, more ways to run it.** The app was split into pages, could be embedded as a NEAR Social / BOS component, and switched to Nearblocks for account history. Fungible tokens joined the report. Prices came first from Yahoo Finance and then from CoinGecko, and users could enter custom exchange rates. The year report got a print view and custom periods. In April 2024 it moved on-chain: a web4 contract served the whole app from `arizportfolio.near`. The tests moved to web-test-runner.

**2025: the limits of rebuilding everything in the browser.** Fetching every transaction and balance from public APIs was slow and kept hitting rate limits. The app tried FastNEAR, went back to Nearblocks, and moved to a private RPC endpoint.

**2026, first half: a server does the heavy lifting.** In January the app began downloading pre-computed history from an accounting export service. That service, the price service and the gateway in front of them became the **Ariz gateway**, with NEP-413 wallet login and Ariz credits to pay for it. Counterparty classification arrived, and the Transactions page began showing every balance change. The browser repository moved from IndexedDB to OPFS, and the gateway became a git remote you could back up to.

**2026, mid-year: Portfolio and privacy.** The Portfolio page gave a holdings view: liquid against staked, value over time, and where the money came from. Staking accounting was rebuilt, and deposits are no longer booked as rewards. Sync became end-to-end encrypted and then encryption became the only way to sync. The web4 contract stopped embedding the app and now points at the gateway, which made the encrypted-sync service worker possible. Support for confidential NEAR Intents history followed, stored only on your device.

**2026, autumn: getting the numbers right.** Recent work has gone into correctness: one value for both sides of a swap, instalment trades treated as one trade, stNEAR priced by its contract rate, a check of confidential balances against the source, dated prices, and an exclude list for tokens no one prices.

# License

[MIT](LICENSE.md)
