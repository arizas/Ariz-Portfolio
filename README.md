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
