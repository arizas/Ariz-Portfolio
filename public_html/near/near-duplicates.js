// One NEAR movement stored twice, a few blocks apart.
//
// The accounting export served petersalomonsen.near ten intents withdrawals
// (2026-10-22 to 11-09, about 26.6 NEAR) twice, four blocks apart, with the same
// amount and the same balances on both sides. Read as a ledger, each copy is an
// outflow that never happened; summed, it is income twice. The exporter now
// keeps one copy (near-accounting-export#71), and this is the same rule on the
// app's side: for a file fetched before that, for copies a merge between devices
// brings back, and for any other writer that makes them.
//
// Copies are rows of `near` that are the same movement: the same amount with the
// same balances on both sides within a few blocks, or one receipt with one
// amount at two blocks (a receipt executes in exactly one block). Rows in one
// block are never copies: two transfers settling in one block both carry that
// block's balances.
//
// Which copy is right is not a matter of where it came from: in one pair the
// transfers API's row was early, in another the row without a transaction. The
// chain decides, and only the chain: a copy is kept when the account's balance at
// the block before it and at its block are its balances. Nothing is removed
// unless the chain confirms a copy, and when it confirms every copy they are
// separate movements and all stay. That is why this runs without asking the
// owner: it removes only what the chain shows did not happen at that block.

/** How far apart copies are looked for: they were four blocks apart; a credit settles within five. */
export const NEAR_COPY_SPAN = 10;

/** Transaction details a kept copy takes from a dropped one when it has none. */
const DETAILS = ['tx_hash', 'receipt_id', 'signer_id', 'receiver_id', 'predecessor_id', 'counterparty'];

const isDigits = (value) => typeof value === 'string' && /^-?\d+$/.test(value);
const missing = (record, field) => record[field] == null || (field === 'counterparty' && record[field] === 'unknown');

/**
 * Groups of rows that are one NEAR movement stored more than once. Pure: no
 * network. Each group is an array of the rows themselves, oldest block first.
 */
export function findNearCopies(records) {
    const candidates = records.filter((r) => r?.token_id === 'near' && !r.reconciled && r.amount !== '0'
        && isDigits(r.amount) && isDigits(r.balance_before) && isDigits(r.balance_after) && Number.isSafeInteger(r.block_height));

    const parent = candidates.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const join = (a, b) => { parent[find(a)] = find(b); };

    const byMovement = new Map();
    const byReceipt = new Map();
    candidates.forEach((r, i) => {
        const movement = `${BigInt(r.amount)}|${BigInt(r.balance_before)}|${BigInt(r.balance_after)}`;
        byMovement.set(movement, [...(byMovement.get(movement) ?? []), i]);
        if (r.receipt_id) {
            const receipt = `${r.receipt_id}|${BigInt(r.amount)}`;
            byReceipt.set(receipt, [...(byReceipt.get(receipt) ?? []), i]);
        }
    });
    for (const members of byMovement.values()) {
        const sorted = [...members].sort((a, b) => candidates[a].block_height - candidates[b].block_height);
        for (let k = 1; k < sorted.length; k++) {
            const [a, b] = [candidates[sorted[k - 1]], candidates[sorted[k]]];
            if (a.block_height !== b.block_height && b.block_height - a.block_height <= NEAR_COPY_SPAN) join(sorted[k - 1], sorted[k]);
        }
    }
    for (const members of byReceipt.values()) {
        for (let k = 1; k < members.length; k++) {
            if (candidates[members[k]].block_height !== candidates[members[0]].block_height) join(members[0], members[k]);
        }
    }

    const groups = new Map();
    candidates.forEach((_, i) => {
        const root = find(i);
        groups.set(root, [...(groups.get(root) ?? []), candidates[i]]);
    });
    return [...groups.values()]
        .filter((group) => group.length > 1)
        .map((group) => group.sort((a, b) => a.block_height - b.block_height));
}

/**
 * A name for a group of copies that a later fetch gives again: the receipt when
 * a copy has one, else the movement and its blocks. What the owner's choice for
 * a group the chain could not settle is stored under.
 */
export function nearCopyKey(group) {
    const withReceipt = group.find((r) => r.receipt_id);
    if (withReceipt) return `receipt:${withReceipt.receipt_id}:${BigInt(withReceipt.amount)}`;
    const r = group[0];
    return `movement:${BigInt(r.amount)}:${BigInt(r.balance_before)}:${BigInt(r.balance_after)}:${group.map((c) => c.block_height).join(',')}`;
}

/** The copy kept at `block`, with the transaction details the dropped ones had and it lacked. */
function keepOne(group, block) {
    const kept = group.find((r) => r.block_height === block);
    const dropped = group.filter((r) => r !== kept);
    const merged = { ...kept };
    for (const field of DETAILS) {
        const from = dropped.find((r) => !missing(r, field));
        if (missing(merged, field) && from) merged[field] = from[field];
    }
    return { kept, merged, dropped };
}

/**
 * Apply the owner's choices for groups the chain could not settle: keep the row
 * at the chosen block, or every row (`keep: 'all'`). A choice whose block is not
 * in the group any more is ignored, and the group is left as it is.
 *
 * @param {object[]} records
 * @param {Record<string, {keep: number|'all'}>} choices by nearCopyKey
 * @returns {{records: object[], removed: object[], decided: Set<string>}}
 */
export function applyNearCopyChoices(records, choices = {}) {
    const drop = new Set();
    const replace = new Map();
    const decided = new Set();
    for (const group of findNearCopies(records)) {
        const key = nearCopyKey(group);
        const choice = choices[key];
        if (!choice) continue;
        if (choice.keep === 'all') {
            decided.add(key);
            continue;
        }
        if (!group.some((r) => r.block_height === choice.keep)) continue;
        const { kept, merged, dropped } = keepOne(group, choice.keep);
        dropped.forEach((r) => drop.add(r));
        replace.set(kept, merged);
        decided.add(key);
    }
    if (drop.size === 0) return { records, removed: [], decided };
    return { records: records.filter((r) => !drop.has(r)).map((r) => replace.get(r) ?? r), removed: [...drop], decided };
}

/**
 * Keep, of each group of copies, the ones the chain confirms; drop the rest.
 *
 * @param {object[]} records the records as stored
 * @param {(blocks: number[]) => Promise<Map<number, string>>} nearBalancesAt the account's NEAR
 *   balance at each block; a block it could not read is left out of the map
 * @returns {Promise<{records: object[], removed: object[], unresolved: object[][]}>}
 *   `records` is the input array itself when nothing was removed
 */
export async function resolveNearCopies(records, nearBalancesAt, { skip = new Set() } = {}) {
    const groups = findNearCopies(records).filter((group) => !skip.has(nearCopyKey(group)));
    if (groups.length === 0) return { records, removed: [], unresolved: [] };

    const blocks = [...new Set(groups.flat().flatMap((r) => [r.block_height - 1, r.block_height]))];
    const balanceAt = await nearBalancesAt(blocks);
    const confirmedByChain = (r) => {
        const [before, after] = [balanceAt.get(r.block_height - 1), balanceAt.get(r.block_height)];
        return before !== undefined && after !== undefined
            && BigInt(before) === BigInt(r.balance_before) && BigInt(after) === BigInt(r.balance_after);
    };

    const drop = new Set();
    const replace = new Map();
    const unresolved = [];
    for (const group of groups) {
        const confirmed = group.filter(confirmedByChain);
        if (confirmed.length === group.length) continue; // separate movements
        if (confirmed.length === 0) {
            unresolved.push(group);
            continue;
        }
        const dropped = group.filter((r) => !confirmed.includes(r));
        dropped.forEach((r) => drop.add(r));
        for (const kept of confirmed) {
            replace.set(kept, keepOne([kept, ...dropped], kept.block_height).merged);
        }
    }
    if (drop.size === 0) return { records, removed: [], unresolved };
    return {
        records: records.filter((r) => !drop.has(r)).map((r) => replace.get(r) ?? r),
        removed: [...drop],
        unresolved,
    };
}

/**
 * The account's NEAR balance at blocks, through the gateway's balances API. A
 * block the gateway could not read is left out, so its copies stay as they are.
 */
export function gatewayNearBalances(chain, account) {
    return async (blocks) => {
        const { balances } = await chain.readBalances(account, blocks.map((block) => ({ kind: 'near', token: 'near', block })));
        return new Map(balances.filter((b) => isDigits(b?.balance)).map((b) => [b.block, b.balance]));
    };
}
