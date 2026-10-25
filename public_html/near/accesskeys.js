import { fetchFromArizGateway, isSignedIn, loginToArizGateway } from '../arizgateway/arizgatewayaccess.js';

/**
 * A FastNear call through the Ariz gateway (/api/fastnear), which carries its
 * API key and bills the signed-in account in ARIZ. Straight from the browser
 * an account with many keys runs into rate limits. A request turned away for
 * being one too many, or one FastNear did not answer in time, is tried again
 * after a pause.
 * @param {string} path - /rpc, /archival-rpc, /tx/v0/account or /tx/v0/transactions
 * @param {object} body
 */
export async function fastnear(path, body, pauses = [1000, 3000, 9000]) {
    if (!(await isSignedIn())) {
        await loginToArizGateway();
        if (!(await isSignedIn())) {
            throw new Error('Sign in to the Ariz gateway: access keys are looked up through it');
        }
    }
    for (let attempt = 0; ; attempt++) {
        try {
            return await fetchFromArizGateway(`/api/fastnear${path}`, { body, showProgress: false });
        } catch (e) {
            if (/^402 /.test(e.message)) {
                throw new Error('Looking up keys through the gateway is paid in ARIZ. Authorize the gateway on the'
                    + ' Ariz credits page, with the account you are signed in with.', { cause: e });
            }
            // Turned away, or FastNear did not answer in time: worth another try.
            const passing = /^(429|502|503|504) /.test(e.message) || /did not answer/.test(e.message);
            if (!passing || attempt >= pauses.length) {
                throw e;
            }
        }
        await new Promise(resolve => setTimeout(resolve, pauses[attempt]));
    }
}

const rpcCall = (method, params) => ({ jsonrpc: '2.0', id: method, method, params });

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
    const json = await fastnear('/rpc',
        rpcCall('query', { request_type: 'view_access_key_list', finality: 'final', account_id: accountId }));
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
        const json = await fastnear('/archival-rpc', rpcCall('block', { block_id: height }));
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
                ...(sameKey && before.lastUseNotIndexed !== undefined ? { lastUseNotIndexed: before.lastUseNotIndexed } : {}),
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

const SIGNED_PAGE_SIZE = 200;
const TRANSACTIONS_PER_CALL = 20;

/**
 * Find when each key last signed, from FastNear's index of the transactions
 * the account signed (directly, or in a delegate action a relayer submitted),
 * newest first. The first signature found with a key is its last use.
 *
 * A key whose last use is already known at its current nonce has not signed
 * since, so it is not looked for again; a run after the first only goes as
 * far back as the keys that moved. A key not found in the whole index (it
 * signed before the index begins) is remembered as such for its nonce.
 *
 * Sets `observed.lastUsed` (or `observed.lastUseNotIndexed`) in place.
 *
 * @param {object} params
 * @param {object} params.accessKeys - accesskeys.json content
 * @param {string} params.accountId
 * @param {number} [params.maxPages] - pages of 200 signed transactions per run
 * @param {Function} [params.call] - (path, body) => JSON, see fastnear()
 * @param {Function} [params.onProgress] - (pagesRead, keysLeft) => true to stop
 * @returns {Promise<{pages: number, complete: boolean}>} complete: the search
 *   ended because every key was found or the index ran out, not at the page limit
 */
export async function findLastUses({ accessKeys, accountId, maxPages = 25, call = fastnear, onProgress = () => false }) {
    const wanted = new Map(Object.entries(accessKeys.keys)
        .filter(([, { observed }]) => observed && !observed.deletedBetween && observed.transactionsSigned > 0
            && observed.lastUsed?.nonce !== observed.nonce && observed.lastUseNotIndexed !== observed.nonce)
        .map(([publicKey, { observed }]) => [publicKey, observed]));

    let pages = 0;
    let resumeToken;
    while (wanted.size > 0) {
        if (pages >= maxPages || onProgress(pages, wanted.size)) {
            return { pages, complete: false };
        }
        const page = await call('/tx/v0/account', {
            account_id: accountId, is_any_signer: true, limit: SIGNED_PAGE_SIZE,
            ...(resumeToken ? { resume_token: resumeToken } : {})
        });
        pages++;
        // An answer without the list is an error, never the end of the index:
        // taken as the end, it would mark keys as not indexed for good.
        if (!Array.isArray(page?.account_txs)) {
            throw new Error(`FastNear's index of signed transactions did not answer with a list: ${JSON.stringify(page).substring(0, 200)}`);
        }
        const listed = page.account_txs;
        const transactions = new Map();
        for (let i = 0; i < listed.length; i += TRANSACTIONS_PER_CALL) {
            const answer = await call('/tx/v0/transactions',
                { tx_hashes: listed.slice(i, i + TRANSACTIONS_PER_CALL).map(tx => tx.transaction_hash) });
            if (!Array.isArray(answer?.transactions)) {
                throw new Error(`FastNear did not answer with the transactions: ${JSON.stringify(answer).substring(0, 200)}`);
            }
            for (const tx of answer.transactions) {
                transactions.set(tx.transaction.hash, tx.transaction);
            }
        }
        for (const { transaction_hash, tx_block_timestamp } of listed) {
            const transaction = transactions.get(transaction_hash);
            for (const { publicKey, nonce, relayer } of transaction ? signaturesOf(transaction, accountId) : []) {
                const observed = wanted.get(publicKey);
                // A key removed and added again has a new start nonce: a
                // signature from below it belongs to the earlier key.
                if (observed && (observed.addedBlock === null || nonce >= (observed.addedBlock - 1) * NONCE_RANGE_MULTIPLIER)) {
                    observed.lastUsed = {
                        txHash: transaction_hash,
                        at: new Date(Number(BigInt(tx_block_timestamp) / 1_000_000n)).toISOString(),
                        nonce,
                        relayer
                    };
                    delete observed.lastUseNotIndexed;
                    wanted.delete(publicKey);
                }
            }
        }
        resumeToken = page.resume_token;
        if (!resumeToken) {
            for (const observed of wanted.values()) {
                observed.lastUseNotIndexed = observed.nonce;
            }
            break;
        }
    }
    return { pages, complete: true };
}
