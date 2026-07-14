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

| Movement | Example | Default treatment | Cost basis |
|---|---|---|---|
| Bridge in/out of intents | `BTC` → `BTC ( NEAR Intents / Bitcoin )` | **Realization** | Reset to value at bridge time |
| Shield / unshield | `USDC ( NEAR Intents / Ethereum )` ⇄ `USDC ( Confidential / Ethereum )` | **Transfer** (not a realization) | Carries over unchanged |
| Swap (any bucket, incl. confidential) | confidential BTC → NEAR | **Realization** | New basis for proceeds |

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

### Why shielding defaults to transfer

Shielding moves a balance between the public and confidential ledgers of the
**same intents token on the same chain**. Every element that made cbBTC a
realization is absent:

- **No new token**: the 1Click API reports shieldings with
  `originAsset == destinationAsset` (identical asset id) and
  `amountIn == amountOut` exactly.
- **No chain crossing** — both sides live in the same NEAR intents system.
- **No third-party issuer** and **no counterparty**.
- **No consideration** (*vederlag*): Skatteetaten's realization definition
  requires "overføring av eiendomsrett **mot vederlag** og opphør av
  eiendomsrett" — nothing is received in exchange; the owner's own balance
  changes visibility.

It is therefore modeled like a transfer between one's own wallets, which is
not a realization. **Caveat:** SKNS1-2025-83 shows the authorities interpret
"replacement" expansively, and a claim on the TEE ledger could conceivably be
argued to be a distinct asset. The bucket separation preserves the complete
movement trail, so this policy can be flipped without data loss. For
significant amounts, a *bindende forhåndsuttalelse* (binding advance ruling)
is the way to certainty.

### Confidential swaps are ordinary realizations

A swap executed confidentially (e.g. BTC → NEAR inside the confidential
ledger) is a sale of one virtual asset settled in another — the textbook
realization example in Skatteetaten's guidance. It appears on no public
explorer, which is precisely why the report fetches confidential history via
the authenticated 1Click API (issue #75): omitting it would silently
understate taxable gains.

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
