import { __setTestWallet, arizgatewayhost } from '../arizgateway/arizgatewayaccess.js';
import { rpcUrl } from './rpc.js';

// Shared test doubles for the intentshistory specs (not a spec file itself —
// wtr only runs *.spec.js). Response shapes are taken from real 1Click API
// captures (see scripts/intents-history-poc.mjs).

export const ONECLICK_TEST_URL = 'https://oneclick.example.test';
// History lives on a separate host from auth (see intentshistory.js HOST SPLIT).
export const ONECLICK_HISTORY_TEST_URL = 'https://oneclick-history.example.test';

/** Deterministic fake wallet that counts NEP-413 signatures. */
export function signingWallet(accountId) {
    const wallet = {
        accountId,
        signatureCount: 0,
        async getAccounts() { return [{ accountId }]; },
        async signMessage({ message, recipient }) {
            wallet.signatureCount++;
            const seed = `${accountId}|${recipient}|${message}`;
            const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed)));
            const sig = new Uint8Array(64);
            sig.set(bytes); sig.set(bytes, 32);
            return {
                accountId,
                publicKey: 'ed25519:CziSGowWUKiP5N5pqGUgXCJXtqpySAk29YAU6zEs5RAi',
                signature: btoa(String.fromCharCode(...sig)),
            };
        },
        async signOut() { },
    };
    __setTestWallet(wallet);
    return wallet;
}

/** A history item in the real /v0/account/history shape. */
export function historyItem(overrides = {}) {
    return {
        status: 'SUCCESS',
        depositType: 'INTENTS',
        recipientType: 'CONFIDENTIAL_INTENTS',
        createdAt: '2026-07-08T18:04:42.251349Z',
        depositAddress: 'd882dbe192c2ad667cbf96f6def7f6a9414c57d20eaaf8cd87600302b73fbe46',
        depositMemo: null,
        originAsset: 'nep141:btc.omft.near',
        amountInFormatted: '0.00544253',
        amountInUsd: '338.351205040000',
        destinationAsset: 'nep141:btc.omft.near',
        amountOutFormatted: '0.00544253',
        amountOutUsd: '338.351205040000',
        recipient: 'petersalomonsen.near',
        refundTo: 'petersalomonsen.near',
        refundType: 'CONFIDENTIAL_INTENTS',
        refundReason: null,
        ...overrides,
    };
}

/** The live host's cursor: base64url of {createdAt, depositAddress, depositMemo}. */
function encodeCursor(item) {
    return btoa(JSON.stringify({
        createdAt: item.createdAt,
        depositAddress: item.depositAddress,
        depositMemo: item.depositMemo ?? null,
    })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(cursor) {
    if (!cursor) return null;
    return JSON.parse(atob(cursor.replace(/-/g, '+').replace(/_/g, '/')));
}

/**
 * In-memory mock of the whole backend surface the module touches: the gateway
 * config endpoint, the NEAR RPC current_salt view, and the 1Click auth +
 * history endpoints (cursor pagination per filter, optional 500s).
 */
export function mockIntentsBackend() {
    const state = {
        configStatus: 200,
        config: {
            apiUrl: ONECLICK_TEST_URL,
            historyApiUrl: ONECLICK_HISTORY_TEST_URL,
            apiKey: 'test-oneclick-key',
        },
        salt: 'aabbccdd',
        // The account's whole history feed, in any order — the mock serves it
        // the way the real host does (newest-first, cursor-paged). Filters are
        // NOT applied, because the live host ignores them.
        feed: [],
        pageLimit: 50,
        // Confidential ledger balances: intents asset id -> raw-unit string.
        balances: new Map(),
        failBeforeSuccess: 0, // next N history requests answer 500
        authResponse: null,   // override the /v0/auth/authenticate body
        authenticateCalls: 0,
        refreshCalls: 0,
        refreshStatus: 200,
        historyRequests: [],
        balanceRequests: 0,
        lastAuthBody: null,
        tokenCounter: 0,
    };

    const json = (status, body) => new Response(JSON.stringify(body), {
        status, headers: { 'content-type': 'application/json' },
    });

    const realFetch = window.fetch;
    window.fetch = async (url, init = {}) => {
        const u = String(url);

        if (u === `${arizgatewayhost}/api/intents/config`) {
            if (state.configStatus !== 200) return json(state.configStatus, { error: 'not_configured' });
            return json(200, state.config);
        }

        if (u === rpcUrl) {
            const body = JSON.parse(init.body);
            if (body.params?.method_name === 'current_salt') {
                const bytes = Array.from(new TextEncoder().encode(JSON.stringify(state.salt)));
                return json(200, { jsonrpc: '2.0', id: body.id, result: { result: bytes } });
            }
            return json(200, { error: { message: `unexpected view ${body.params?.method_name}` } });
        }

        if (u.startsWith(ONECLICK_HISTORY_TEST_URL)) {
            const path = u.slice(ONECLICK_HISTORY_TEST_URL.length);
            if (init.headers?.['x-api-key'] !== state.config.apiKey) {
                return json(403, { message: 'invalid api key' });
            }
            if (path.startsWith('/v0/account/history')) {
                const params = new URL(u).searchParams;
                state.historyRequests.push({
                    query: path,
                    bearer: init.headers?.authorization?.replace('Bearer ', ''),
                });
                if (state.failBeforeSuccess > 0) {
                    state.failBeforeSuccess--;
                    return json(500, { message: 'AMQP Request failed' });
                }
                // Newest-first, exactly like the live host. `depositType` and
                // `recipientType` are deliberately IGNORED here: since 2026-09
                // the real host returns the identical page for every value of
                // them (and for no filter at all).
                const feed = [...state.feed].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
                // A cursor is an EXCLUSIVE bound anchored on one end of the
                // page just served: `prevCursor` asks for OLDER items,
                // `nextCursor` for NEWER ones. Both travel in the query
                // parameter of the same name.
                const older = decodeCursor(params.get('prevCursor'));
                const newer = decodeCursor(params.get('nextCursor'));
                const page = feed
                    .filter((i) => !older || i.createdAt < older.createdAt)
                    .filter((i) => !newer || i.createdAt > newer.createdAt)
                    .slice(0, Math.min(Number(params.get('limit') ?? state.pageLimit), state.pageLimit));
                return json(200, {
                    items: page,
                    // Anchored at the NEWEST item on the page, so following it
                    // asks for items newer than the newest — an empty page.
                    nextCursor: page.length ? encodeCursor(page[0]) : (params.get('prevCursor') ?? null),
                    // Anchored at the OLDEST item on the page: the way back.
                    prevCursor: page.length ? encodeCursor(page[page.length - 1]) : null,
                });
            }
            if (path.startsWith('/v0/account/balances')) {
                state.balanceRequests++;
                return json(200, {
                    balances: [...state.balances].map(([tokenId, available]) => ({
                        tokenId, available, source: 'private',
                    })),
                });
            }
            return json(404, { message: `unexpected history path ${path}` });
        }

        if (u.startsWith(ONECLICK_TEST_URL)) {
            const path = u.slice(ONECLICK_TEST_URL.length);
            if (init.headers?.['x-api-key'] !== state.config.apiKey) {
                return json(403, { message: 'invalid api key' });
            }
            if (path === '/v0/auth/authenticate') {
                state.authenticateCalls++;
                state.lastAuthBody = JSON.parse(init.body);
                const sd = state.lastAuthBody.signedData;
                if (sd?.standard !== 'nep413' || !sd.payload?.message || !sd.payload?.nonce
                    || !sd.public_key?.startsWith('ed25519:') || !sd.signature?.startsWith('ed25519:')) {
                    return json(400, { message: 'malformed signedData' });
                }
                state.tokenCounter++;
                // `authResponse` lets a test return a malformed body (e.g. one
                // with no accessToken) without hand-rolling a fetch stub.
                return json(201, state.authResponse ?? {
                    accessToken: `access-${state.tokenCounter}`,
                    refreshToken: `refresh-${state.tokenCounter}`,
                    expiresIn: 900,
                    refreshExpiresIn: 604800,
                });
            }
            if (path === '/v0/auth/refresh') {
                state.refreshCalls++;
                if (state.refreshStatus !== 200) return json(state.refreshStatus, { message: 'refresh rejected' });
                state.tokenCounter++;
                return json(201, {
                    accessToken: `access-${state.tokenCounter}`,
                    refreshToken: `refresh-${state.tokenCounter}`,
                    expiresIn: 900,
                    refreshExpiresIn: 604800,
                });
            }
            return json(404, { message: `unexpected 1Click path ${path}` });
        }

        return realFetch(url, init);
    };

    state.restore = () => { window.fetch = realFetch; };
    return state;
}
