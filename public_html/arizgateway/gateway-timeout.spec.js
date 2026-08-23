import { fetchFromArizGateway, GATEWAY_TIMEOUT_MILLIS, __setTestWallet } from './arizgatewayaccess.js';
import { ACCESS_TOKEN_SESSION_STORAGE_KEY } from './arizgatewayaccess.js';

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
