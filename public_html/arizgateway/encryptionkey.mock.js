import { __setTestWallet, arizgatewayhost } from './arizgatewayaccess.js';

// Shared test doubles for the encryption-key/encrypted-sync specs (not a spec
// file itself — wtr only runs *.spec.js).

// Deterministic fake wallet: a fixed fake "signature" per (accountId, message,
// recipient) — enough for derivation, which never verifies signatures.
export function fakeWallet(accountId, { hedged = false } = {}) {
    let counter = 0;
    __setTestWallet({
        accountId,
        async getAccounts() { return [{ accountId }]; },
        async signMessage({ message, recipient }) {
            const seed = `${accountId}|${recipient}|${message}${hedged ? `|${counter++}` : ''}`;
            const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed)));
            const sig = new Uint8Array(64);
            sig.set(bytes); sig.set(bytes, 32);
            return {
                accountId,
                publicKey: 'ed25519:CziSGowWUKiP5N5pqGUgXCJXtqpySAk29YAU6zEs5RAi',
                signature: btoa(String.fromCharCode(...sig)),
            };
        },
        async signOut() {},
    });
}

// In-memory mock of the gateway's /store/me wraps + refs-probe endpoints.
export function mockStore() {
    const state = { wraps: new Map(), refsExists: false, unauthorized: false };
    const realFetch = window.fetch;
    window.fetch = async (url, init = {}) => {
        const u = String(url);
        if (!u.startsWith(`${arizgatewayhost}/store/me`)) return realFetch(url, init);
        if (state.unauthorized) return new Response('failed to parse token', { status: 401 });
        const path = u.slice(`${arizgatewayhost}/store/me`.length);
        if (path === '/refs') {
            return state.refsExists
                ? new Response(new Uint8Array([1]), { status: 200 })
                : new Response('{"error":"not found"}', { status: 404 });
        }
        const wrapMatch = path.match(/^\/keys\/([0-9a-f]{32})$/);
        if (wrapMatch) {
            const id = wrapMatch[1];
            if ((init.method ?? 'GET') === 'GET') {
                const wrap = state.wraps.get(id);
                return wrap
                    ? new Response(wrap, { status: 200 })
                    : new Response('{"error":"not found"}', { status: 404 });
            }
            if (init.method === 'PUT') {
                if (state.wraps.has(id)) return new Response('{"error":"wrap already exists"}', { status: 412 });
                state.wraps.set(id, new Uint8Array(await new Response(init.body).arrayBuffer()));
                return new Response(null, { status: 204 });
            }
        }
        return new Response('unexpected', { status: 500 });
    };
    state.restore = () => { window.fetch = realFetch; };
    return state;
}
