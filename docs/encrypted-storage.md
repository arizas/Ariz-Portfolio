# Encrypted repository storage

Ariz Portfolio can synchronize your data repository to the Ariz gateway with the
**entire repository encrypted on your device before anything leaves it**. The
server stores only ciphertext: it cannot read your files, your history, or even
your filenames — and neither can the storage provider, or anyone who ever got
hold of the stored bytes.

> Status: the storage backend is **live**; the in-app integration is in progress
> ([#76](https://github.com/arizas/Ariz-Portfolio/issues/76)). Until the app
> switches over, the existing (plaintext, per-account-isolated) git sync remains
> the default.

## Why

Your Ariz data repository contains more than public blockchain data. It holds
things you have **curated**, which can be genuinely private:

- **which NEAR accounts you control** — the repo groups all your accounts;
- **counterparty classifications** — who you marked as income, expense, deposit;
- custom exchange rates, report configuration, and — planned
  ([#75](https://github.com/arizas/Ariz-Portfolio/issues/75)) — **confidential
  NEAR intents transactions**, which are not visible on-chain at all.

On-chain transaction data itself is public by nature, and fetching/monitoring it
is the service the gateway provides — that data is processed server-side as part
of the accounting feature. The encrypted store exists for everything *beyond*
that: your private, curated layer should be **backed up without being disclosed —
to anyone, including the operator of the gateway**.

## What is protected, from whom

| | You | Gateway operator | Storage provider / stolen bucket bytes |
|---|---|---|---|
| File contents (classifications, groupings, reports) | ✅ full access | 🔒 ciphertext only | 🔒 ciphertext only |
| Filenames, directory structure, commit history & messages | ✅ | 🔒 | 🔒 |
| Which accounts are grouped together in your repo | ✅ | 🔒 | 🔒 |
| Your identity as the owner of stored objects | ✅ | knows at request time (it authenticates you) | 🔒 blinded (HMAC ids) |
| That *some* store received pushes of N bytes at time T | ✅ | visible | visible |

Two design notes behind that table:

- **Encryption is client-side, whole-repo.** Rather than encrypting individual
  files (git-crypt style — which leaks filenames, sizes and history), the sync
  layer encrypts entire git *packfiles* and the branch manifest with
  **AES-256-GCM** before upload. The store is just opaque blobs.
- **Blinded storage paths.** Object keys are `HMAC-SHA256(server secret,
  account)` rather than your account name, so bucket-level observers cannot even
  tell *which* accounts use the feature. (A plain hash would not be enough —
  account names are public and enumerable, so they could be dictionary-reversed.)

## How it works

A git remote helper is a small program that turns `git push`/`fetch` into reads
and writes against some backend. In the browser, a **service worker** plays that
exact role: it intercepts the app's ordinary git traffic (the app uses
[wasm-git](https://github.com/petersalomonsen/wasm-git)) and implements the
transfer itself — encrypting on the way out, decrypting on the way in.

```
Browser: wasm-git ── git smart-HTTP ──> service worker ──┐   AES-256-GCM
                                                         ├──> gateway /store ──> object storage
CLI:     git ── remote-helper ──> git-remote-egit ───────┘   (ciphertext only)
```

- Every push stores one **encrypted packfile**; a small encrypted **refs
  manifest** tracks branches. Concurrent pushes are safe (compare-and-set on the
  manifest — a stale push is rejected exactly like a non-fast-forward in git).
- The gateway authenticates you (NEP-413 wallet signature — the same login the
  rest of the app uses), scopes you to your own store, and passes opaque bytes
  through to object storage. It holds **no keys** and performs **no
  cryptography**.
- The sync layer is the reusable
  [encrypted-git-storage](https://github.com/petersalomonsen/encrypted-git-storage)
  library, where the format and both transports are tested — including
  browser↔CLI interoperability and a "the stored bytes are not a git repository"
  assertion.

## Your key

The encryption key is **derived from a wallet signature** (a fixed,
app-namespaced NEP-413 message → HKDF-SHA256 → AES-256 key):

- **No extra secret to remember** — any device where you can sign with your
  wallet can derive the same key.
- **The key never leaves your device.** It is not stored on, nor recoverable
  from, the gateway.
- **Losing wallet access means losing the data** — by design, nobody else can
  decrypt it. Export and safely store the key if you want an independent backup
  path.
- There is no retroactive revocation: anyone who ever held the key can decrypt
  history they already downloaded (the same is true of any E2E-encrypted system).

## Access from a regular git client

The repository stays a real git repository. With the
[`git-remote-egit`](https://github.com/petersalomonsen/encrypted-git-storage)
helper installed and your exported key:

```sh
export EGIT_KEY=<your exported key>        # 64 hex chars
export EGIT_AUTH="Bearer <NEP-413 token>"  # your gateway login token
git clone egit::https://arizgateway.fly.dev/store/me
```

`me` resolves to your blinded store server-side — you never need to know the
actual storage path.

## Honest limitations

- **Traffic metadata**: the gateway (not the public) can see that your account
  pushed N encrypted bytes at time T. Contents, filenames, and history are never
  visible.
- **On-chain data is not secret**: the accounting/monitoring feature processes
  your public blockchain history server-side — that is the product, not a leak.
  The encrypted store protects the private layer on top of it.
- **Key loss is unrecoverable** — see above.
