import { rpcUrl } from './rpc.js';

// The regular RPC only keeps a few days of transactions and blocks.
export const archivalRpcUrl = 'https://archival-rpc.mainnet.fastnear.com/';

/**
 * A JSON-RPC call to the archival RPC. Too many calls at once are turned away
 * without CORS headers, which the browser reports only as a failed fetch, so
 * a failed fetch is tried again after a pause.
 */
export async function archivalRpc(method, params, pauses = [1000, 3000, 9000]) {
    for (let attempt = 0; ; attempt++) {
        try {
            const response = await fetch(archivalRpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params })
            });
            if (response.status !== 429) {
                return await response.json();
            }
            if (attempt >= pauses.length) {
                throw new Error(`The archival RPC turned away ${method}: too many requests`);
            }
        } catch (e) {
            if (attempt >= pauses.length) {
                throw e;
            }
        }
        await new Promise(resolve => setTimeout(resolve, pauses[attempt]));
    }
}

// An access key's nonce says more than it looks. Since early in mainnet's life
// a newly added key does not start at 0 but at (block_height - 1) * 10^6, where
// block_height is the block the AddKey was applied in. Each transaction the key
// signs then adds one (wallets use nonce + 1). So from the nonce alone:
//
//   added in block  floor(nonce / 10^6) + 1
//   signed          nonce mod 10^6 transactions
//
// Keys added before that rule started at 0, so their nonce is just the count of
// transactions and their block is unknown. Such a nonce is far below the first
// mainnet block, which is how they are told apart.
export const NONCE_RANGE_MULTIPLIER = 1_000_000;
const MAINNET_GENESIS_HEIGHT = 9_820_210;

/**
 * @param {number} nonce
 * @returns {{addedBlock: number|null, transactionsSigned: number}}
 */
export function decodeNonce(nonce) {
    const startBlock = Math.floor(nonce / NONCE_RANGE_MULTIPLIER);
    if (startBlock < MAINNET_GENESIS_HEIGHT) {
        return { addedBlock: null, transactionsSigned: nonce };
    }
    return { addedBlock: startBlock + 1, transactionsSigned: nonce % NONCE_RANGE_MULTIPLIER };
}

/**
 * The account's access keys as they are now.
 * @param {string} accountId
 * @returns {Promise<{blockHeight: number, keys: Array<{publicKey: string, nonce: number, permission: object}>}>}
 */
export async function fetchAccessKeys(accountId) {
    const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'accesskeys',
            method: 'query',
            params: { request_type: 'view_access_key_list', finality: 'final', account_id: accountId }
        })
    });
    const json = await response.json();
    const error = json.error ?? (json.result?.error ? { message: json.result.error } : null);
    if (error) {
        throw new Error(`Could not list the access keys of ${accountId}: ${error.data ?? error.cause?.name ?? error.message}`);
    }
    return {
        blockHeight: json.result.block_height,
        keys: json.result.keys.map(key => ({
            publicKey: key.public_key,
            nonce: key.access_key.nonce,
            permission: normalizePermission(key.access_key.permission)
        }))
    };
}

// The RPC spells a full access key as the string "FullAccess" and a function
// call key as {FunctionCall: {...}}. One shape is easier to store and render.
function normalizePermission(permission) {
    if (permission === 'FullAccess') {
        return { type: 'FullAccess' };
    }
    const functionCall = permission.FunctionCall;
    return {
        type: 'FunctionCall',
        receiverId: functionCall.receiver_id,
        methodNames: functionCall.method_names,
        allowance: functionCall.allowance
    };
}

/**
 * When a block was produced, as an ISO timestamp. A height can be skipped by
 * the chain, so the next few heights stand in for it.
 * @param {number} blockHeight
 * @returns {Promise<string|null>}
 */
export async function getBlockTimestamp(blockHeight) {
    for (let height = blockHeight; height < blockHeight + 5; height++) {
        const json = await archivalRpc('block', { block_id: height });
        const nanos = json.result?.header?.timestamp_nanosec;
        if (nanos) {
            return new Date(Number(BigInt(nanos) / 1_000_000n)).toISOString();
        }
    }
    return null;
}

/**
 * Fold a fresh key list into what is stored. Only the `observed` part of a key
 * is ever the chain's to change; `notes` are the user's and survive every
 * refresh, including the key being deleted. A deleted key stays in the file,
 * marked with the checks it disappeared between, because "this was on my old
 * laptop and I removed it" is part of the record.
 *
 * Between two checks the chain says nothing about when a key signed, only
 * whether its nonce moved. So `lastUseWindow` is the pair of checks the nonce
 * last moved between: the key was last used after `from` and before `to`.
 *
 * @param {object|null} stored - the accesskeys.json content, or null
 * @param {{blockHeight: number, keys: Array}} fetched - from fetchAccessKeys
 * @param {string} checkedAt - ISO timestamp of this check
 * @returns {object} the new accesskeys.json content
 */
export function mergeAccessKeys(stored, fetched, checkedAt) {
    const previousCheck = stored?.checkedAt ?? null;
    const keys = {};
    for (const [publicKey, entry] of Object.entries(stored?.keys ?? {})) {
        keys[publicKey] = { ...entry };
    }

    const present = new Set();
    for (const { publicKey, nonce, permission } of fetched.keys) {
        present.add(publicKey);
        const { addedBlock, transactionsSigned } = decodeNonce(nonce);
        const before = keys[publicKey]?.observed;
        // Deleted and added again is a new key on chain: a new start nonce.
        const sameKey = before && !before.deletedBetween && before.addedBlock === addedBlock;

        let lastUseWindow = sameKey ? before.lastUseWindow ?? null : null;
        if (sameKey && before.nonce !== nonce) {
            lastUseWindow = { from: previousCheck, to: checkedAt };
        }

        keys[publicKey] = {
            ...keys[publicKey],
            observed: {
                permission,
                nonce,
                addedBlock,
                addedAt: sameKey ? before.addedAt ?? null : null,
                transactionsSigned,
                firstSeenAt: sameKey ? before.firstSeenAt : checkedAt,
                lastUseWindow,
                lastUsed: sameKey ? before.lastUsed ?? null : null,
                deletedBetween: null
            }
        };
    }

    for (const [publicKey, entry] of Object.entries(keys)) {
        if (!present.has(publicKey) && entry.observed && !entry.observed.deletedBetween) {
            entry.observed = { ...entry.observed, deletedBetween: { from: previousCheck, to: checkedAt } };
        }
    }

    return { checkedAt, checkedAtBlock: fetched.blockHeight, keys };
}

/**
 * Fill in `addedAt` for keys whose creation block is known but not yet dated.
 * Dates are fetched once and then kept by mergeAccessKeys.
 */
export async function dateAddedKeys(accessKeys, blockTimestamp = getBlockTimestamp) {
    const undated = Object.values(accessKeys.keys)
        .map(entry => entry.observed)
        .filter(observed => observed?.addedBlock && !observed.addedAt);
    // An account can have a hundred keys or more: a few lookups at a time, so
    // the RPC does not turn them away.
    const next = async () => {
        for (let observed = undated.shift(); observed; observed = undated.shift()) {
            try {
                observed.addedAt = await blockTimestamp(observed.addedBlock);
            } catch (e) {
                console.warn(`Could not date block ${observed.addedBlock}`, e);
            }
        }
    };
    await Promise.all(Array.from({ length: 2 }, next));
    return accessKeys;
}


/**
 * The signatures `accountId` put on a transaction. The account signs either
 * the transaction itself, or, when a relayer submitted it (a meta transaction,
 * NEP-366), the delegate action inside it. Both use one of the account's
 * access keys and move that key's nonce.
 * @param {object} transaction - the `transaction` of an RPC `tx` result
 * @param {string} accountId
 * @returns {Array<{publicKey: string, nonce: number, relayer: string|null}>}
 */
export function signaturesOf(transaction, accountId) {
    const signatures = [];
    if (transaction.signer_id === accountId) {
        signatures.push({ publicKey: transaction.public_key, nonce: transaction.nonce, relayer: null });
    }
    for (const action of transaction.actions ?? []) {
        const delegateAction = action?.Delegate?.delegate_action;
        if (delegateAction?.sender_id === accountId) {
            signatures.push({ publicKey: delegateAction.public_key, nonce: delegateAction.nonce, relayer: transaction.signer_id });
        }
    }
    return signatures;
}

/**
 * Look a transaction up on the archival RPC and return the account's
 * signatures on it. A hash the chain does not know as a transaction (the
 * history can hold receipt ids) has none.
 */
export async function fetchTransactionSignatures(txHash, accountId) {
    const json = await archivalRpc('tx', { tx_hash: txHash, sender_account_id: accountId, wait_until: 'NONE' });
    if (json.error?.cause?.name === 'UNKNOWN_TRANSACTION') {
        return [];
    }
    if (json.error) {
        throw new Error(`Could not look up transaction ${txHash}: ${json.error.data ?? json.error.message}`);
    }
    return signaturesOf(json.result.transaction, accountId);
}

/**
 * Find when each key last signed, by looking up the account's transactions
 * newest first. The first signature found with a key is its latest in the
 * history; if it carries the key's current nonce, it is the latest there is.
 *
 * Lookups are kept in `signatureCache` (hash -> signatures), so a second run
 * costs nothing for what is already checked. At most `maxLookups` new lookups
 * are made per run.
 *
 * @param {object} params
 * @param {object} params.accessKeys - accesskeys.json content; `observed.lastUsed` is set in place
 * @param {Array<{hash: string, block_timestamp: string}>} params.transactions - newest first
 * @param {string} params.accountId
 * @param {object} params.signatureCache
 * @param {number} [params.maxLookups]
 * @param {Function} [params.lookup]
 * @param {Function} [params.onProgress] - (checked, total) => true to stop
 * @returns {Promise<{looked: number, unchecked: number}>} lookups made, and transactions left unchecked
 */
export async function findLastUses({ accessKeys, transactions, accountId, signatureCache,
    maxLookups = 200, lookup = fetchTransactionSignatures, onProgress = () => false }) {
    const wanted = new Map(Object.entries(accessKeys.keys)
        .filter(([, { observed }]) => observed && !observed.deletedBetween && observed.transactionsSigned > 0)
        .map(([publicKey, { observed }]) => [publicKey, observed]));
    for (const observed of wanted.values()) {
        observed.lastUsed = null;
    }

    let looked = 0;
    let index = 0;
    for (; index < transactions.length && wanted.size > 0; index++) {
        const { hash, block_timestamp } = transactions[index];
        let signatures = signatureCache[hash];
        if (!signatures) {
            if (looked >= maxLookups || onProgress(index, transactions.length)) {
                break;
            }
            signatures = await lookup(hash, accountId);
            signatureCache[hash] = signatures;
            looked++;
        }
        for (const { publicKey, nonce, relayer } of signatures) {
            const observed = wanted.get(publicKey);
            // A key removed and added again has a new start nonce: a signature
            // from below it belongs to the earlier key.
            if (observed && (observed.addedBlock === null || nonce >= (observed.addedBlock - 1) * NONCE_RANGE_MULTIPLIER)) {
                observed.lastUsed = {
                    txHash: hash,
                    at: new Date(Number(BigInt(block_timestamp) / 1_000_000n)).toISOString(),
                    nonce,
                    relayer
                };
                wanted.delete(publicKey);
            }
        }
    }
    return { looked, unchecked: wanted.size > 0 ? transactions.length - index : 0 };
}
