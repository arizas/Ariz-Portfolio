import { __setTestWallet, arizgatewayhost } from '../arizgateway/arizgatewayaccess.js';
import { rpcUrl } from './rpc.js';

// Shared test doubles for the intentshistory specs (not a spec file itself —
// wtr only runs *.spec.js). Response shapes are taken from real 1Click API
// captures (see scripts/intents-history-poc.mjs).

export const ONECLICK_TEST_URL = 'https://oneclick.example.test';

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

/**
 * In-memory mock of the whole backend surface the module touches: the gateway
 * config endpoint, the NEAR RPC current_salt view, and the 1Click auth +
 * history endpoints (cursor pagination per filter, optional 500s).
 */
export function mockIntentsBackend() {
    const state = {
        configStatus: 200,
        config: { apiUrl: ONECLICK_TEST_URL, apiKey: 'test-oneclick-key' },
        salt: 'aabbccdd',
        // pages per filter: filter string -> array of pages (arrays of items)
        pages: {
            'recipientType=CONFIDENTIAL_INTENTS': [[]],
            'depositType=CONFIDENTIAL_INTENTS': [[]],
        },
        failBeforeSuccess: 0, // next N history requests answer 500
        authenticateCalls: 0,
        refreshCalls: 0,
        refreshStatus: 200,
        historyRequests: [],
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
                return json(201, {
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
                const filter = ['recipientType', 'depositType']
                    .filter((k) => params.has(k))
                    .map((k) => `${k}=${params.get(k)}`)
                    .join('&');
                const pages = state.pages[filter] ?? [[]];
                const page = Number(params.get('nextCursor') ?? 0);
                const items = pages[page] ?? [];
                return json(200, {
                    items,
                    nextCursor: page + 1 < pages.length ? String(page + 1) : null,
                });
            }
            return json(404, { message: `unexpected 1Click path ${path}` });
        }

        return realFetch(url, init);
    };

    state.restore = () => { window.fetch = realFetch; };
    return state;
}
