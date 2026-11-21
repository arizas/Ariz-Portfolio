import { fetchFromArizGateway, isSignedIn, loginToArizGateway } from '../arizgateway/arizgatewayaccess.js';

// An account's access keys come from the Ariz gateway (/api/accesskeys), which
// asks FastNear with its API key, keeps what never changes, and bills the
// signed-in account in ARIZ for the requests it had to make. Each key comes
// with what its nonce says (the block it was added in and when, how many
// transactions it signed) and its last use as far as the gateway knows it.

/**
 * A call to /api/accesskeys, signed in. A request the gateway did not answer
 * in time is tried again after a pause.
 */
async function accessKeysApi(path, { post = false, pauses = [1000, 3000, 9000] } = {}) {
    if (!(await isSignedIn())) {
        await loginToArizGateway();
        if (!(await isSignedIn())) {
            throw new Error('Sign in to the Ariz gateway: access keys are looked up through it');
        }
    }
    for (let attempt = 0; ; attempt++) {
        try {
            return await fetchFromArizGateway(`/api/accesskeys${path}`, { showProgress: false, ...(post ? { body: {} } : {}) });
        } catch (e) {
            if (/^402 /.test(e.message)) {
                throw new Error('Looking up keys through the gateway is paid in ARIZ. Authorize the gateway on the'
                    + ' Ariz credits page, with the account you are signed in with.', { cause: e });
            }
            if (!/did not answer/.test(e.message) || attempt >= pauses.length) {
                throw e;
            }
        }
        await new Promise(resolve => setTimeout(resolve, pauses[attempt]));
    }
}

/**
 * The account's keys as they are now.
 * @returns {Promise<{blockHeight: number, keys: Array}>}
 */
export function fetchAccessKeys(accountId, options) {
    return accessKeysApi(`/${encodeURIComponent(accountId)}`, options);
}

/**
 * The keys, after the gateway has searched on for the last uses it did not
 * know. `lastUseSearch.complete` is false when there is more to search: ask
 * again and it goes on from there.
 * @returns {Promise<{blockHeight: number, keys: Array, lastUseSearch: {complete: boolean}}>}
 */
export function searchLastUses(accountId, options) {
    return accessKeysApi(`/${encodeURIComponent(accountId)}/lastuse`, { ...options, post: true });
}

/**
 * Fold a fresh key list into what is stored. Only the `observed` part of a key
 * is ever the chain's to change; `notes` are the user's and survive every
 * refresh, including the key being deleted. A deleted key stays in the file,
 * marked with the checks it disappeared between, because "this was on my old
 * laptop and I removed it" is part of the record.
 *
 * Until its last use is found, all that says when a key signed is whether its
 * nonce moved between two checks: `lastUseWindow` is the pair of checks it
 * last moved between.
 *
 * @param {object|null} stored - the accesskeys.json content, or null
 * @param {{blockHeight: number, keys: Array}} fetched - from the gateway
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
    for (const key of fetched.keys) {
        const { publicKey, nonce } = key;
        present.add(publicKey);
        const before = keys[publicKey]?.observed;
        // Deleted and added again is a new key on chain: a new start nonce.
        const sameKey = before && !before.deletedBetween && before.addedBlock === key.addedBlock;

        let lastUseWindow = sameKey ? before.lastUseWindow ?? null : null;
        if (sameKey && before.nonce !== nonce) {
            lastUseWindow = { from: previousCheck, to: checkedAt };
        }

        keys[publicKey] = {
            ...keys[publicKey],
            observed: {
                permission: key.permission,
                nonce,
                addedBlock: key.addedBlock,
                addedAt: key.addedAt ?? null,
                transactionsSigned: key.transactionsSigned,
                firstSeenAt: sameKey ? before.firstSeenAt : checkedAt,
                lastUseWindow,
                lastUsed: key.lastUse ?? null,
                lastUseNotIndexed: !!key.lastUseNotIndexed,
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
