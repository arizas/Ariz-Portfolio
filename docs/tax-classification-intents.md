# Token classification and tax treatment: NEAR Intents and confidential holdings

How Ariz Portfolio classifies the *same underlying asset* held in different
custody forms, and the default tax treatment applied to movements between
them. The tax reasoning below follows **Norwegian** guidance (Skatteetaten) —
the classification itself is jurisdiction-neutral, but the realization
defaults may be wrong for other countries and MUST be reviewed against local
rules. Nothing here is tax advice; the report is a calculation aid, and the
user is responsible for their own filing.

## Buckets

One logical asset (e.g. USDC) can exist in three custody forms, each tracked
as its own balance bucket:

| Bucket | Example display symbol | Where it lives | Independently verifiable via |
|---|---|---|---|
| Native / L1 | `USDC` | The asset's own chain (or an exchange) | Chain explorers / APIs |
| NEAR Intents | `USDC ( NEAR Intents / Ethereum )` | The intents multi-token contract on NEAR (`…omft.near` / nep245 asset ids) | NEAR RPC (public) |
| Confidential | `USDC ( Confidential / Ethereum )` | The intents confidential (TEE) ledger | Only the owner, via the authenticated 1Click API (`/v0/account/balances`, `/v0/account/history`) |

Separate buckets are required for **reconciliation**, independent of any tax
question: shielded balances are invisible to all public APIs, so without a
Confidential bucket the books cannot balance against observable chain data.

## Movement types and default treatment

| Movement | Example | Treatment (as implemented) | Cost basis |
|---|---|---|---|
| Bridge in/out of intents | `BTC` → `BTC ( NEAR Intents / Bitcoin )` | **Realization** | Reset to value at bridge time |
| Shield / unshield | `USDC ( NEAR Intents / Ethereum )` ⇄ `USDC ( Confidential / Ethereum )` | **Realization** (same as every bucket move) | Reset to value at shield time |
| Swap (any bucket, incl. confidential) | confidential BTC → NEAR | **Realization**, both legs on one figure (see below) | Same figure as the source's proceeds |
| Credit into the confidential ledger (no origin) | `+0.000019448868 wNEAR ( Confidential )`, nothing leaving | **Inflow** from `intents.near` — not a bucket move | Value at credit time |

A credit is a history item typed `CONFIDENTIAL_INTENTS` on both sides that
names a destination asset and amount but no origin asset, amount in, or quote
transaction: the host has added balance to the ledger without taking anything
out of another bucket. First seen 2026-09-20 as two wNEAR credits of
0.000019448868, confirmed by `/v0/account/balances`: exactly one millionth of
the account's 19.448868 NEAR allocation in NEAR@3.33, a one-time reward
distribution paid into the confidential balance, so a rehearsal of that
payout. The handling is generic, not specific to that program: any credit is
booked as a single inbound movement and reaches the year report the way any
other value arriving from `intents.near` does — a reward is income at its
value when received, which is what basis at credit time expresses.

The year-report engine treats *every* move between buckets as a realization
with profit/loss against the leaving bucket's basis. The Confidential bucket
deliberately reuses that uniform rule rather than introducing a special
basis-carry-over path — one consistent, simple policy, aligned with the
strict direction of current Norwegian practice.

### Why bridging defaults to realization

Skatte-ABC **V-13-3.4.3 "Overføring mellom blokkjeder"**: moving a token from
one blockchain to another normally means the taxpayer has given up ownership
of the original token and replaced it with another — a realization. Cross
chain bridging and wrapping are given as examples.

The binding ruling **SKNS1-2025-83** (Skatteklagenemnda, 11.12.2025) applied
this strictly to Coinbase's BTC ⇄ cbBTC conversion: even though the
conversion was automatic, 1:1, fee-free, custody-preserving, and the taxpayer
argued they never possessed cbBTC and remained beneficial owner of the BTC
throughout ("more pledge than exchange"), the conversion was ruled a taxable
realization (skatteloven §§ 5-1(2), 6-2(1), 9-2(1)); the appeal was rejected.
Depositing L1 assets into the intents contract (receiving `…omft.near`
tokens on NEAR) is structurally the same operation: a different token, issued
by a third party, on a different chain.

### On treating shielding as a realization

A defensible argument exists that shielding is a mere transfer: it moves a
balance between the public and confidential ledgers of the **same intents
token on the same chain** — the 1Click API reports shieldings with
`originAsset == destinationAsset` and `amountIn == amountOut` exactly, there
is no chain crossing, no third-party issuer, no counterparty and no
consideration (*vederlag*). However, SKNS1-2025-83 shows the authorities
interpret "replacement of one token with another" expansively (the taxpayer's
1:1 / never-possessed / beneficial-ownership arguments were all rejected),
and treating shielding **the same as every other bucket move** keeps one
uniform rule and errs on the strict side.

Consequences of the uniform realization treatment:

- **Gains** are recognized earlier than a transfer treatment would require —
  the basis resets correspondingly higher, so total tax over time is
  equivalent; only timing differs. Unproblematic.
- **Losses**: recognizing a loss on a shielding claims a deduction
  (*fradrag*) that would not exist if shielding is legally a transfer. In
  practice shieldings realize at (near-)zero P/L — they usually follow a
  bridge-in that already reset the basis, and stablecoins barely move — but
  **if a shielding ever shows a material loss, do not deduct it without
  obtaining a bindende forhåndsuttalelse**.

The bucket separation preserves the complete movement trail, so the policy
could still be revisited without data loss.

### Confidential swaps are ordinary realizations

A swap executed confidentially (e.g. BTC → NEAR inside the confidential
ledger) is a sale of one virtual asset settled in another — the textbook
realization example in Skatteetaten's guidance. It appears on no public
explorer, which is precisely why the report fetches confidential history via
the authenticated 1Click API (issue #75): omitting it would silently
understate taxable gains.

### Both sides of a swap are valued on one figure

A swap's proceeds and the cost basis of what it bought are the same number.
Valuing the leg that left at its own token's close and the leg that arrived at
its token's close gives two numbers, and the difference — the intraday move of
both tokens plus the spread — is realized on one side and never enters the
other, so it leaves the books for good (`docs/performance-comparison.md`
measured it on real swaps). This also matches the guidance: the consideration
for a disposal is the value of what was received.

Which figure, in order (`public_html/yearreport/swap-legs.js`):

1. **A stablecoin leg**, its amount at that day's price — the nearest thing to
   a fiat receipt the chain offers. The destination side wins if both sides
   are stable. A stablecoin disposal therefore shows no gain of its own, and
   what it bought opens at exactly what was paid.
2. **The destination legs at their end-of-day price.** The source is sold for
   what came back, and the spread lands as a small realized loss on it.
3. **The source legs at their close**, only when nothing on the destination
   side has a price that day.

A price the owner entered for a specific transaction (a custom realization
rate, keyed by hash) outranks all three. Exact fiat marks from the venue
(1Click reports `amountInUsd` / `amountOutUsd` per leg) would sit above the
stablecoin rule; they are not read yet.

Gas is not a leg: the speck of NEAR every token transaction moves is set
aside when it is under 1 % of the largest leg beside it, so a USDC → BTC trade
does not sell 0.0005 NEAR for 28 dollars.

Legs are paired on the transaction hash, or on the deposit address for the
two synthetic halves of a confidential swap. A swap whose legs straddle
midnight UTC, or whose other half happened outside the tracked accounts, is
not paired and stays what it looks like: a plain withdrawal or deposit at the
day's rate.

**Earlier tax years.** This changes the realized figures of any year with
swaps. Years already filed need a decision — pin the previous rule for swaps
dated before a cutoff, or file a correction if the difference is material.
Not handled yet.

## References

- Skatteetaten — Skatteregler for virtuell valuta (definition of
  *realisasjon*):
  <https://www.skatteetaten.no/person/skatt/hjelp-til-riktig-skatt/aksjer-og-verdipapirer/om/virtuell-valuta/skatteregler---virtuell-valuta/>
- Skatte-ABC V-13-3.4.3 *Overføring mellom blokkjeder* (bridging/wrapping
  normally = realization).
- Skatteklagenemnda SKNS1-2025-83 — *BFU: Realisasjon ved konvertering mellom
  kryptovalutaer* (BTC ⇄ cbBTC ruled a realization despite 1:1 automatic
  custody-preserving conversion):
  <https://www.skatteetaten.no/rettskilder/type/vedtak/skatteklagenemnda/bfu--realisasjon-ved-konvertering-mellom-kryptovalutaer/>
- Skatteloven §§ 5-1(2), 6-2(1), 9-2(1).

*Other jurisdictions classify these events differently (some treat wrapping
as non-taxable; some tax nothing until fiat exit). The bucket model supports
any policy — only the defaults above are Norway-specific.*
