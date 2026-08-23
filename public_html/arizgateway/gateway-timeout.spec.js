import { fetchFromArizGateway, GATEWAY_TIMEOUT_MILLIS, __setTestWallet, ACCESS_TOKEN_SESSION_STORAGE_KEY } from './arizgatewayaccess.js';

// A fetch with no timeout does not fail, it waits. One stalled price lookup
// froze the portfolio page on "Calculating NPRO (3 of 46)" for six minutes:
// no error, no pending request the profiler could see, ninety-eight per cent
// idle. Every caller of this can carry on without an answer, so failing beats
// hanging.
describe('waiting for the gateway', () => {
    let realFetch;
    before(() => {
        realFetch = globalThis.fetch;
        localStorage.setItem(ACCESS_TOKEN_SESSION_STORAGE_KEY,
            JSON.stringify({ token: 'test', accountId: 'test.near', issuedAt: Date.now() }));
    });
    after(() => {
        globalThis.fetch = realFetch;
        localStorage.removeItem(ACCESS_TOKEN_SESSION_STORAGE_KEY);
        __setTestWallet(null);
    });

    it('gives up rather than waiting forever', async () => {
        // A request that never settles, exactly as the live one behaved.
        globalThis.fetch = (url, opts) => new Promise((_, reject) => {
            opts?.signal?.addEventListener('abort', () => {
                const e = new Error('aborted');
                e.name = 'TimeoutError';
                reject(e);
            });
        });
        let message = '';
        try {
            await fetchFromArizGateway('/api/prices/nopricetokens', { timeoutMillis: 50 });
        } catch (e) { message = e.message; }
        expect(message).to.include('did not answer');
        expect(message).to.include('/api/prices/nopricetokens');
    });

    // A timeout arriving as a bare abort would read as the token having no
    // price, which is a different thing and would be recorded as such.
    it('says it was the wait, not the answer', async () => {
        globalThis.fetch = (url, opts) => new Promise((_, reject) => {
            opts?.signal?.addEventListener('abort', () => {
                const e = new Error('aborted');
                e.name = 'AbortError';
                reject(e);
            });
        });
        let name = '';
        try {
            await fetchFromArizGateway('/anything', { timeoutMillis: 30 });
        } catch (e) { name = e.message; }
        expect(name).to.include('did not answer');
    });

    it('passes a real answer straight through', async () => {
        globalThis.fetch = async () => ({ ok: true, json: async () => ({ hello: 'world' }) });
        expect(await fetchFromArizGateway('/api/anything')).to.deep.equal({ hello: 'world' });
    });

    it('has a default long enough for a real reply', () => {
        expect(GATEWAY_TIMEOUT_MILLIS).to.be.greaterThan(5000);
    });
});

// Sending a rejected token again cannot change the answer. A retry loop around
// this turned one expired token into four identical failures two seconds apart,
// with "401 : token expired retrying in 2 seconds" on screen and nothing that
// would ever fix it.
describe('a token the gateway will not accept', () => {
    let realFetch, signed;
    beforeEach(() => {
        realFetch = globalThis.fetch;
        signed = 0;
        localStorage.setItem(ACCESS_TOKEN_SESSION_STORAGE_KEY,
            JSON.stringify({ token: 'stale', accountId: 'test.near', issuedAt: Date.now() }));
        __setTestWallet({
            getAccounts: async () => [{ accountId: 'test.near' }],
            signMessage: async () => {
                signed++;
                return { accountId: 'test.near', publicKey: 'ed25519:k', signature: 'c2ln' };
            },
        });
    });
    afterEach(() => {
        globalThis.fetch = realFetch;
        localStorage.removeItem(ACCESS_TOKEN_SESSION_STORAGE_KEY);
        __setTestWallet(null);
    });

    it('signs a new one and asks again', async () => {
        const sent = [];
        globalThis.fetch = async (url, opts) => {
            sent.push(opts.headers.authorization);
            return sent.length === 1
                ? { ok: false, status: 401, statusText: 'Unauthorized', text: async () => 'token expired' }
                : { ok: true, status: 200, json: async () => ({ prices: 'here' }) };
        };
        expect(await fetchFromArizGateway('/api/prices/current')).to.deep.equal({ prices: 'here' });
        expect(signed).to.equal(1);
        expect(sent[0]).to.not.equal(sent[1]);
    });

    // Two ends can disagree about how long a token lives; re-signing settles it
    // without anyone having to work out which end moved.
    it('does not sign twice when the new one is refused as well', async () => {
        let calls = 0;
        globalThis.fetch = async () => {
            calls++;
            return { ok: false, status: 401, statusText: 'Unauthorized', text: async () => 'token expired' };
        };
        let message = '';
        try { await fetchFromArizGateway('/api/prices/current'); } catch (e) { message = e.message; }
        expect(calls).to.equal(2);
        expect(signed).to.equal(1);
        expect(message).to.include('401');
    });

    // Background work must still not put a wallet dialog on screen.
    it('asks for a signature rather than prompting, when not interactive', async () => {
        let calls = 0;
        globalThis.fetch = async () => {
            calls++;
            return { ok: false, status: 401, statusText: 'Unauthorized', text: async () => 'token expired' };
        };
        let name = '';
        try {
            await fetchFromArizGateway('/api/prices/history', { interactive: false });
        } catch (e) { name = e.name; }
        expect(name).to.equal('SignatureRequiredError');
        expect(signed).to.equal(0);
        expect(calls).to.equal(1);
    });
});
