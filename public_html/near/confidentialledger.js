import { CONFIDENTIAL_TOKEN_PREFIX } from './intents-tokens.js';

// Derivation of the confidential (TEE-ledger) token bucket from 1Click history
// items (issue #75). The confidential ledger is invisible to every public API,
// so its balance series is reconstructed client-side from the owner's
// authenticated history (fetched by intentshistory.js, persisted only in the
// user's git repository). Pure functions — metadata (decimals/symbols) is
// passed in by the caller.
//
// Every movement in or out of the confidential bucket (shield, unshield,
// confidential swap) is an ordinary bucket move for the year report: the
// existing per-bucket FIFO engine realizes profit/loss on it — see
// docs/tax-classification-intents.md.

/**
 * Convert a decimal amount string (e.g. "0.00544253") to raw integer units.
 * Exact BigInt arithmetic — no floats. Fractions beyond `decimals` digits are
 * truncated.
 * @param {string} formatted
 * @param {number} decimals
 * @returns {string} raw units as a decimal string
 */
export function formattedAmountToRaw(formatted, decimals) {
    const [intPart, fracPart = ''] = String(formatted).split('.');
    const frac = fracPart.slice(0, decimals).padEnd(decimals, '0');
    return (BigInt(intPart + frac)).toString();
}

/**
 * The individual confidential-ledger movements (legs) of a 1Click history
 * item. A shielding deposits into the ledger, an unshielding withdraws from
 * it, a confidential swap does both (different assets). Non-SUCCESS items
 * produce no movements.
 * @param {object} item - 1Click /v0/account/history item
 * @returns {Array<{assetId: string, direction: 'in'|'out', amountFormatted: string, createdAt: string, txHash: string|null, depositAddress: string}>}
 */
export function confidentialMovementsForItem(item) {
    if (item.status !== 'SUCCESS') return [];
    const txHash = item.quoteTransactions?.[0]?.txHash ?? null;
    const movements = [];
    if (item.depositType === 'CONFIDENTIAL_INTENTS') {
        movements.push({
            assetId: item.originAsset,
            direction: 'out',
            amountFormatted: item.amountInFormatted,
            createdAt: item.createdAt,
            txHash,
            depositAddress: item.depositAddress,
        });
    }
    if (item.recipientType === 'CONFIDENTIAL_INTENTS') {
        movements.push({
            assetId: item.destinationAsset,
            direction: 'in',
            amountFormatted: item.amountOutFormatted,
            createdAt: item.createdAt,
            txHash,
            depositAddress: item.depositAddress,
        });
    }
    return movements;
}

function confidentialTokenId(assetId) {
    return `${CONFIDENTIAL_TOKEN_PREFIX}${assetId}`;
}

// Deterministic synthetic transaction hash for a movement. Prefixed so derived
// rows are recognizable (and stripped before any write-back of the fungible
// token transactions file).
function syntheticHash(movement) {
    return `${CONFIDENTIAL_TOKEN_PREFIX}${movement.depositAddress}:${movement.direction}`;
}

/**
 * All movements of a history-item list, oldest-first, with running per-token
 * confidential balances attached (raw units).
 * @param {object[]} items
 * @param {Map<string, {decimals: number, symbol: string}>} metadataByAsset - keyed by intents asset id
 */
function movementsWithBalances(items, metadataByAsset) {
    const movements = [...items]
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
        .flatMap(confidentialMovementsForItem);
    const balances = {};
    return movements.map((movement) => {
        const metadata = metadataByAsset.get(movement.assetId);
        if (!metadata) throw new Error(`missing token metadata for ${movement.assetId}`);
        const raw = BigInt(formattedAmountToRaw(movement.amountFormatted, metadata.decimals));
        const signed = movement.direction === 'in' ? raw : -raw;
        const before = balances[movement.assetId] ?? 0n;
        const after = before + signed;
        balances[movement.assetId] = after;
        return { ...movement, ...metadata, signedRawAmount: signed, balanceBefore: before, balanceAfter: after };
    });
}

/**
 * Derive records-shaped rows (the Transactions page format) for the
 * confidential bucket, oldest-first. Same shape as the gateway's
 * BalanceChangeRecord, with token_id "confidential:<assetId>" and no block
 * height (the confidential ledger is off-chain; block_timestamp carries the
 * ordering).
 * @param {object[]} items - 1Click history items
 * @param {Map<string, {decimals: number, symbol: string}>} metadataByAsset
 */
export function deriveConfidentialRecords(items, metadataByAsset) {
    return movementsWithBalances(items, metadataByAsset).map((m) => ({
        block_height: null,
        block_timestamp: m.createdAt,
        token_id: confidentialTokenId(m.assetId),
        amount: m.signedRawAmount.toString(),
        balance_before: m.balanceBefore.toString(),
        balance_after: m.balanceAfter.toString(),
        counterparty: 'intents.near',
        tx_hash: m.txHash,
    }));
}

/**
 * Derive fungible-token-transaction-shaped rows (the year-report format) for
 * the confidential bucket, NEWEST-first (the engine walks the balance series
 * in that order). ft.contract_id is "confidential:<assetId>", so the
 * confidential holdings form their own bucket and every move in/out realizes
 * against its own FIFO positions.
 * @param {object[]} items - 1Click history items
 * @param {string} accountId - the owning account
 * @param {Map<string, {decimals: number, symbol: string}>} metadataByAsset
 */
export function deriveConfidentialFtTransactions(items, accountId, metadataByAsset) {
    return movementsWithBalances(items, metadataByAsset).map((m) => ({
        // Always the synthetic hash — reusing the real quote txHash here would
        // group the confidential leg with the public-side leg in the year
        // report's by-hash grouping and net out the bucket move instead of
        // realizing it.
        transaction_hash: syntheticHash(m),
        block_height: null,
        block_timestamp: (BigInt(new Date(m.createdAt).getTime()) * 1_000_000n).toString(),
        account_id: accountId,
        delta_amount: m.signedRawAmount.toString(),
        involved_account_id: 'intents.near',
        balance: m.balanceAfter.toString(),
        ft: {
            contract_id: confidentialTokenId(m.assetId),
            symbol: m.symbol,
            decimals: m.decimals,
        },
        args: {},
        _source: 'confidential-intents',
    })).reverse();
}

/**
 * True for fungible-token-transaction rows that were DERIVED from the
 * confidential history (as opposed to fetched from the gateway) — these must
 * never be written back to fungible_token_transactions.json.
 */
export function isDerivedConfidentialFtTransaction(transaction) {
    return transaction?._source === 'confidential-intents'
        || !!transaction?.ft?.contract_id?.startsWith(CONFIDENTIAL_TOKEN_PREFIX);
}
