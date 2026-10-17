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
| Confidential | `USDC ( Confidential / Ethereum )` | NEAR Confidential Intents: a private NEAR shard, bridged to mainnet via a TEE | Only the owner, via the authenticated 1Click API (`/v0/account/balances`, `/v0/account/history`) |

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

The binding ruling **SKNS1-2025-83** (Skatteklagenemnda, 11.12.2025,
unanimous, published 8.4.2026) applied this strictly. The facts: to borrow
stablecoins from Spark with BTC as collateral, the taxpayer's BTC was
converted 1:1 to Coinbase's cbBTC (an ERC-20 on Ethereum) by a lending
platform acting as nominee, and the cbBTC deposited in Spark for spcbBTC. The
taxpayer never had direct access to cbBTC and argued they remained owner of
the BTC throughout ("more pledge than exchange"). Both steps were ruled
realization by exchange, skatteloven § 9-2 (1) c; gain taxable under
§ 5-1 (2), loss deductible under § 6-2 (1); the appeal was rejected.

The test the committee applied (sekretariatet's innstilling § 4.3.2, adopted
unanimously) is the one to reuse here: has the exchange *qualitatively
changed the character of the ownership* (Rt. 2014 s. 822 Bonheur, which
applies the continuity test of Rt. 2002 s. 798 Nordea: are the rights after
the transaction of the same character as before)? The taxpayer lost actual
and legal control (*råderett*) over the BTC and could only get it back by
converting back; whoever holds cbBTC holds the right to redeem; and the 1:1
conversion back is only an option, not the same asset. That the taxpayer
never had access to cbBTC did not matter, since the platform acted on their
behalf.

Two supporting lines from skattekontoret's BFU, which the committee upheld:
cbBTC is a separate asset with other properties (another chain, other
verification, other markets, its own economic risk); and securities lending
counted as realization before skatteloven § 9-11, even though the lender got
the same securities back and kept the economic risk, because the ownership
rights became *unusable* (*unyttbare*) to the lender. Technology neutrality
was used against the taxpayer: the treatment is the same whoever carries
out the transaction. The ruling quotes Skatte-ABC 2025 V-13-3.4.1
(crypto-to-crypto), V-13-3.4.2 (liquidity pools) and V-13-3.4.3, and states
its conclusions accord with the last two.

Depositing L1 assets into the intents contract (receiving `…omft.near`
tokens on NEAR) is structurally the same operation: a different token, issued
by a third party, on a different chain.

### On treating shielding as a realization

Under the continuity test of SKNS1-2025-83 the question is whether the rights
keep their character, and shielding can be argued both ways.

- **For a transfer:** the 1Click API reports shieldings with
  `originAsset == destinationAsset` and `amountIn == amountOut` exactly. No
  new token is issued, there is no counterparty and no consideration
  (*vederlag*), and the owner keeps full use of the asset on the confidential
  side.
- **For a realization:** per NEAR (intents.near.org/confidential), the
  confidential balance lives on a **dedicated private NEAR shard**, run by
  permissioned validators and connected to mainnet by a TEE-based bridge. The
  balance leaves the public `intents.near` contract for that shard — other
  verification, its own risk — and Skatte-ABC V-13-3.4.3 names bridging as a
  normal realization. Whether a shard of the same NEAR chain is "another
  blockchain" is exactly the open question.

The ruling did not decide a balance moving between two ledgers of the same
token, so this remains an interpretation. Treating shielding **the same as
every other bucket move** keeps one uniform rule and errs on the strict side.
Templates for requesting a binding ruling on the question are in
[docs/bfu/](bfu/), one for a private person and one for an AS. The question
is the same for both: crypto is not covered by fritaksmetoden (skatteloven
§ 2-38 covers shares and other ownership interests), so a company realizes
gains and losses on crypto under the same rule.

Native NEAR into confidential (the near.com deposit flow: NEAR sent to a
1Click deposit address, wNEAR credited in the confidential ledger) is both a
wrap and a shielding, and realizes on the same rule.

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
other, so it leaves the books for good. Measured on four real swaps in
2026-07/08, the leak ran from 0.2 % to 6.3 % of the trade. This also matches
the guidance: the consideration for a disposal is the value of what was
received.

Which figure, in order (`public_html/yearreport/swap-legs.js`):

1. **The venue's own fiat mark for the destination**: what 1Click said the
   leg was worth when the trade settled (`amountOutUsd`; `amountInUsd` for
   the source if the destination has none). Confidential swaps carry these on
   every history item. The mark is in USD; it is turned into the report
   currency at that day's rate, which is NEAR's close in the report currency
   over NEAR's close in USD — exactly the forex rate the gateway priced every
   token with.
2. **A stablecoin leg**, its amount at that day's price — the nearest thing to
   a fiat receipt the chain itself offers. The destination side wins if both
   sides are stable. A stablecoin disposal therefore shows no gain of its own,
   and what it bought opens at exactly what was paid.
3. **The destination legs at their end-of-day price.** The source is sold for
   what came back, and the spread lands as a small realized loss on it.
4. **The source legs at their close**, only when nothing on the destination
   side has a price that day.

A price the owner entered for a specific transaction (a custom realization
rate, keyed by hash) outranks all four.

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
