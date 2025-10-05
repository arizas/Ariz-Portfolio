Ariz Portfolio
===================

A web application for getting an overview of one or multiple NEAR accounts.

- Create a year report with:
  - daily balances (End Of Day)
  - daily staking rewards (and total for year)
  - daily deposit/withdrawal (and totals for year)
  - daily profit/loss (First-In-First-Out, with totals for year)
- List of transactions per account
- List of staking rewards per account / pool

**IMPORTANT:** This is very much work in progress, and there may be calculation errors, so if you use this you'll still have to verify own your own that the numbers are correct. This should not be used for tax reporting or any kind of reporting without manual verification.

# How to use

Add your accounts under the `Accounts` section. Click `load data` to load data from the blockchain into your browser storage (IndexedDB). The `Year report` section shows all accounts, but you can switch target currency under `View Settings`. If you select an account, this will affect the displayed account data under the `Transactions` and `Staking rewards` view.

# How it works

Daily deposits / withdrawals are calculated by looking at the total balance change for each transaction (instead of going down to each receipt). Balance changes are added up for all accounts involved in a transaction so that transfers between the configured accounts are zeroed out. Also balance changes from transactions to staking pools are ignored.

Transaction data is loaded from wallet helper history, and balances are found by querying Nearblocks for transaction status for each transaction to find the latest execution block and take the account balance from there.

Staking pools are identified by transactions (deposits, staking, withdrawals) to these, and rewards are calculated by the difference in staking pool balance between each epoch.

# Technical details

This is a web application based on EcmaScript Modules, and no framework like React or Angular. It's meant to be a showcase on what you can do with the modern HTML/Javascript that is built into todays web browsers without using heavy frameworks or polyfills. For a component based development model, it use Web Components (Custom Elements), and since I've always preferred separating HTML markup from code (and I also think this is one of the best things with Angular), I've done the same here. Not as sophisticated and performant as Angular, but performant enough, and simple and easy to understand since it's straight forward use of built-in standard HTML technologies.

For storage it's also different, as it does not rely on a server. All data is stored in your browsers IndexedDB storage, in a GIT repository (provided by https://github.com/petersalomonsen/wasm-git). This means that with a serviceworker (coming soon), this web app can be used offline. If you want, you can synchronize the data with a git server. You get all the data synchronization features of git (fetch, merge, push), as well as the changes history.

## Bundling

A must-have for modern single page web apps is bundling into compact javascript/html for deployment to production. Mostly this is provided out of the box for frameworks like React/Angular, but since this app is not using such a framework, it's using [rollup](rollup.config.js) for creating the app bundles. Just to show that it's possible it also packs everything into one html file. This includes html templates, javascript modules and also the webworker for [wasm-git](public_html/storage/wasmgitworker.js).

## Tests

The project uses two testing frameworks:

- **Web Test Runner (WTR)** - For unit tests of individual modules and functions. Test files are located alongside the source files with a `.spec.js` extension (e.g., `balance-tracker.spec.js`). Run with `npm test`.

- **Playwright** - For end-to-end (e2e) tests that test the full application flow in a browser. Test files are located in `playwright_tests/tests/`. Run with `npm run test:e2e`.

The tests load real NEAR account data for verification on actual use cases and calculations. This will be improved by storing the RPC responses so that each test run does not have to load data from RPC.


