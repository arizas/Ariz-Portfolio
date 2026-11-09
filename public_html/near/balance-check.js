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
// Read-only and public: archival RPC and FastNear's account API, no signing.

import { isStakingPool } from './accounting-export.js';

const INTENTS_CONTRACT_ID = 'intents.near';

export const ARCHIVAL_RPC_URL = 'https://archival-rpc.mainnet.fastnear.com/';
export const FASTNEAR_API_URL = 'https://api.fastnear.com';
// A transfer through a contract settles over several receipts: on real data the
// balance a record ends on is on chain one block after the record's block.
export const SETTLE_BLOCKS = [0, 1, 3];
const CONCURRENCY = 4;

export function tokenKind(token) {
    if (token === 'near') return 'near';
    if (/^nep(141|245):/.test(token)) return 'intents';
    if (isStakingPool(token)) return 'staking pool';
    return 'fungible token';
}

/** Raw balances on chain, at a block or now. */
export function createChainReader({ fetchFn = (...args) => fetch(...args), rpcUrl = ARCHIVAL_RPC_URL } = {}) {
    const query = async (params, block) => {
        const response = await fetchFn(rpcUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0', id: 'balance-check', method: 'query',
                params: { ...params, ...(block === 'final' ? { finality: 'final' } : { block_id: block }) },
            }),
        });
        const answer = await response.json();
        if (answer.error) throw new Error(answer.error.cause?.name ?? answer.error.name ?? 'RPC error');
        return answer.result;
    };
    const view = async (contract, method, args, block) => {
        const result = await query({
            request_type: 'call_function', account_id: contract, method_name: method,
            args_base64: btoa(JSON.stringify(args)),
        }, block);
        return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result)));
    };
    return {
        finalHeight: async () => (await query({ request_type: 'view_account', account_id: INTENTS_CONTRACT_ID }, 'final')).block_height,
        balance: async (account, token, block) => {
            switch (tokenKind(token)) {
                case 'near': return (await query({ request_type: 'view_account', account_id: account }, block)).amount;
                case 'intents': return String(await view(INTENTS_CONTRACT_ID, 'mt_balance_of', { account_id: account, token_id: token }, block));
                case 'staking pool': return String(await view(token, 'get_account_total_balance', { account_id: account }, block));
                default: return String(await view(token, 'ft_balance_of', { account_id: account }, block));
            }
        },
        intentsTokens: async (account) => (await view(INTENTS_CONTRACT_ID, 'mt_tokens_for_owner', { account_id: account }, 'final'))
            .map((entry) => entry.token_id),
    };
}

async function inBatches(items, work) {
    const results = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await work(items[index]);
        }
    }));
    return results;
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
export async function checkBalancesAgainstChain(account, records, {
    chain = createChainReader(), fetchFn = (...args) => fetch(...args),
} = {}) {
    const chainHeight = await chain.finalHeight();
    const tokens = await inBatches(lastStoredRows(records), async (row) => {
        const entry = {
            token: row.token_id,
            kind: tokenKind(row.token_id),
            lastStoredBlock: row.block_height,
            lastStoredTime: row.block_timestamp ?? null,
            stored: String(row.balance_after),
        };
        try {
            entry.now = await chain.balance(account, row.token_id, 'final');
            if (entry.now === entry.stored) return { ...entry, status: 'current' };
            const difference = String(BigInt(entry.now) - BigInt(entry.stored));
            let atLastStoredBlock;
            for (const after of SETTLE_BLOCKS) {
                const then = await chain.balance(account, row.token_id, row.block_height + after);
                if (then === entry.stored) return { ...entry, status: 'behind', difference };
                atLastStoredBlock ??= then;
            }
            return { ...entry, status: 'wrong', difference, atLastStoredBlock };
        } catch (error) {
            return { ...entry, status: 'unknown', error: String(error?.message ?? error).slice(0, 200) };
        }
    });

    // What is held now that no stored row mentions. Spam airdrops count too: they
    // are on chain, and only the user can say they do not matter.
    const stored = new Set(tokens.map((t) => t.token));
    const heldButNotStored = [];
    let holdingsError = null;
    try {
        const response = await fetchFn(`${FASTNEAR_API_URL}/v1/account/${encodeURIComponent(account)}/full`);
        if (!response.ok) throw new Error(`FastNear answered ${response.status}`);
        const full = await response.json();
        for (const token of full.tokens ?? []) {
            if (!stored.has(token.contract_id) && token.balance && token.balance !== '0') {
                heldButNotStored.push({ token: token.contract_id, kind: 'fungible token', now: String(token.balance) });
            }
        }
        const pools = (full.pools ?? []).map((pool) => pool.pool_id).filter((pool) => !stored.has(pool));
        const intents = (await chain.intentsTokens(account)).filter((token) => !stored.has(token));
        for (const found of await inBatches([...pools, ...intents], async (token) => {
            try {
                return { token, kind: tokenKind(token), now: await chain.balance(account, token, 'final') };
            } catch (error) {
                return { token, kind: tokenKind(token), error: String(error?.message ?? error).slice(0, 200) };
            }
        })) {
            if (found.error || (found.now && found.now !== '0')) heldButNotStored.push(found);
        }
    } catch (error) {
        holdingsError = String(error?.message ?? error).slice(0, 200);
    }
    return { chainHeight, tokens, heldButNotStored, holdingsListed: holdingsError === null, holdingsError };
}
