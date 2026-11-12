// Whether the stored history ends where the chain says it should.
//
// A history that stops early looks complete from the inside: every balance
// follows from the one before it, right up to the last stored row. Only the
// chain can say that row was not the last. So, per token, the stored final
// balance is put next to what the chain holds now, and where they differ, next
// to what the chain held at the last stored row. The two together tell apart:
//
//   - current: the chain holds what the store says;
//   - behind: the store was right when it ended, and the token has moved since,
//     so a fetch brings it up to date;
//   - wrong: the chain never held what the store ends on, so the stored history
//     itself is wrong or has a gap, and a fetch may not mend it.
//
// And what the account holds now that the store has no row for at all.
//
// Read-only and public, through the Ariz gateway's balances API: a handful of
// requests per account, each with many reads, made with the gateway's FastNear
// key. Straight from the browser, FastNear's archival node allows about 2
// requests a second and answers the rest with a 429 without CORS headers,
// which a check of a few accounts ran into at once.

import { isStakingPool } from './accounting-export.js';
import { fetchFromArizGateway } from '../arizgateway/arizgatewayaccess.js';

// A transfer through a contract settles over several receipts: on real data the
// balance a record ends on is on chain one block after the record's block.
export const SETTLE_BLOCKS = [0, 1, 3];
/** The most reads the gateway takes in one request. */
export const MAX_READS_PER_REQUEST = 300;

export function tokenKind(token) {
    if (token === 'near') return 'near';
    if (/^nep(141|245):/.test(token)) return 'intents';
    if (isStakingPool(token)) return 'staking pool';
    return 'fungible token';
}

const API_KIND = { near: 'near', intents: 'intents', 'staking pool': 'pool', 'fungible token': 'ft' };

/**
 * The gateway's balances API: `readBalances` answers each read with a balance
 * or an error of its own, `holdings` lists what the account holds now.
 */
export function createGatewayChain({ request = fetchFromArizGateway } = {}) {
    const path = (account) => `/api/balances/${encodeURIComponent(account)}`;
    return {
        readBalances: async (account, reads) => {
            let finalHeight = null;
            const balances = [];
            for (let i = 0; i < reads.length; i += MAX_READS_PER_REQUEST) {
                const answer = await request(path(account), {
                    body: { reads: reads.slice(i, i + MAX_READS_PER_REQUEST) }, showProgress: false, timeoutMillis: 120000,
                });
                if (!Array.isArray(answer?.balances)) throw new Error('the gateway did not answer with balances: are you signed in?');
                finalHeight ??= answer.finalHeight;
                balances.push(...answer.balances);
            }
            return { finalHeight, balances };
        },
        holdings: async (account) => {
            const answer = await request(`${path(account)}/holdings`, { showProgress: false });
            if (!Array.isArray(answer?.tokens)) throw new Error('the gateway did not list the holdings: are you signed in?');
            return answer;
        },
    };
}

/** The last stored row of each token: highest block, and the later row on a tie. */
export function lastStoredRows(records) {
    const last = new Map();
    records.forEach((row, index) => {
        if (typeof row?.token_id !== 'string') return;
        const kept = last.get(row.token_id);
        if (!kept || row.block_height > kept.row.block_height || (row.block_height === kept.row.block_height && index > kept.index)) {
            last.set(row.token_id, { row, index });
        }
    });
    return [...last.values()].map(({ row }) => row);
}

/**
 * @param {string} account
 * @param {object[]} records the account's stored records
 * @returns {Promise<{chainHeight: number, tokens: object[], heldButNotStored: object[], holdingsListed: boolean, holdingsError: string|null}>}
 */
export async function checkBalancesAgainstChain(account, records, { chain = createGatewayChain(), progress = () => { } } = {}) {
    const read = (token, block) => ({ kind: API_KIND[tokenKind(token)], token, block });
    const rows = lastStoredRows(records);
    const ask = (reads, what) => {
        progress(`Asking the gateway for ${reads.length} balance${reads.length === 1 ? '' : 's'} of ${account} ${what}`);
        return chain.readBalances(account, reads);
    };

    // Every token now, in one go.
    const now = await ask(rows.length ? rows.map((row) => read(row.token_id, 'final')) : [read('near', 'final')], 'now');
    const tokens = rows.map((row, index) => {
        const answer = now.balances[index];
        const entry = {
            token: row.token_id,
            kind: tokenKind(row.token_id),
            lastStoredBlock: row.block_height,
            lastStoredTime: row.block_timestamp ?? null,
            stored: String(row.balance_after),
        };
        if (answer?.error !== undefined || answer?.balance === undefined) return { ...entry, status: 'unknown', error: answer?.error ?? 'no answer' };
        entry.now = answer.balance;
        return entry.now === entry.stored ? { ...entry, status: 'current' } : entry;
    });

    // Where they differ, what the chain held when the store ends: at the last
    // stored block and the few after it, all in one go.
    const moved = tokens.filter((token) => !token.status);
    const then = moved.length ? await ask(moved.flatMap((token) =>
        SETTLE_BLOCKS.map((after) => read(token.token, token.lastStoredBlock + after))),
    `at the last stored blocks of the ${moved.length} token${moved.length === 1 ? '' : 's'} that moved`) : { balances: [] };
    moved.forEach((token, index) => {
        const answers = then.balances.slice(index * SETTLE_BLOCKS.length, (index + 1) * SETTLE_BLOCKS.length);
        token.difference = String(BigInt(token.now) - BigInt(token.stored));
        if (answers.some((answer) => answer?.balance === token.stored)) {
            token.status = 'behind';
        } else if (answers.every((answer) => answer?.balance === undefined)) {
            token.status = 'unknown';
            token.error = answers[0]?.error ?? 'no answer';
        } else {
            token.status = 'wrong';
            token.atLastStoredBlock = answers.find((answer) => answer?.balance !== undefined).balance;
        }
    });

    // What is held now that no stored row mentions. Spam airdrops count too: they
    // are on chain, and only the user can say they do not matter.
    const stored = new Set(tokens.map((t) => t.token));
    const heldButNotStored = [];
    let holdingsError = null;
    try {
        progress(`Asking the gateway what ${account} holds now`);
        const held = await chain.holdings(account);
        for (const { token, balance } of held.tokens) {
            if (!stored.has(token) && balance && balance !== '0') heldButNotStored.push({ token, kind: 'fungible token', now: balance });
        }
        const toRead = [...held.pools, ...held.intents].filter((token) => !stored.has(token));
        if (toRead.length) {
            const found = await ask(toRead.map((token) => read(token, 'final')), 'held with no stored row');
            toRead.forEach((token, index) => {
                const { balance, error } = found.balances[index] ?? { error: 'no answer' };
                if (error !== undefined) heldButNotStored.push({ token, kind: tokenKind(token), error });
                else if (balance !== '0') heldButNotStored.push({ token, kind: tokenKind(token), now: balance });
            });
        }
    } catch (error) {
        holdingsError = String(error?.message ?? error).slice(0, 200);
    }
    return { chainHeight: now.finalHeight, tokens, heldButNotStored, holdingsListed: holdingsError === null, holdingsError };
}
