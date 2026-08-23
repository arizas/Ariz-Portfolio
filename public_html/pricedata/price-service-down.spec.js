import { fetchHistoricalPricesFromArizGateway, getEODPriceMap, priceServiceStatus, resetPriceService } from './pricedata.js';
import { ACCESS_TOKEN_SESSION_STORAGE_KEY } from '../arizgateway/arizgatewayaccess.js';
import { mockWalletAuthenticationData } from '../arizgateway/arizgatewayaccess.spec.js';

// A report asks for one token's history at a time. With the gateway not
// answering that is one wait per token — the combined view has 46 of them,
// which is twenty minutes of a page that looks busy. The first timeout already
// says what the other forty-five would.
describe('when the price service stops answering', () => {
    let realFetch;
    beforeEach(() => {
        realFetch = globalThis.fetch;
        mockWalletAuthenticationData();
        localStorage.setItem(ACCESS_TOKEN_SESSION_STORAGE_KEY,
            JSON.stringify({ token: 'fresh', accountId: 'test.near', issuedAt: Date.now() }));
        resetPriceService();
    });
    afterEach(() => {
        globalThis.fetch = realFetch;
        resetPriceService();
    });

    // Rejects the way a wait that ran out does, without spending the wait: the
    // path under test is what happens after the timeout, not the clock.
    const stalling = () => {
        let calls = 0;
        globalThis.fetch = async () => {
            calls++;
            const e = new Error('The operation was aborted due to timeout');
            e.name = 'TimeoutError';
            throw e;
        };
        return () => calls;
    };

    it('asks once and then stops asking', async () => {
        const calls = stalling();
        for (const token of ['NEAR', 'BTC', 'SOL', 'USDC']) {
            await fetchHistoricalPricesFromArizGateway({ baseToken: token, currency: 'NOK' })
                .catch(() => { });
        }
        expect(calls()).to.equal(1);
    });

    it('says the service is down, not that the token has no price', async () => {
        stalling();
        let name = '';
        await fetchHistoricalPricesFromArizGateway({ baseToken: 'NEAR', currency: 'NOK' })
            .catch(e => { name = e.name; });
        expect(name).to.equal('PriceServiceNotAnsweringError');
        expect(priceServiceStatus()).to.not.equal(null);
        expect(priceServiceStatus().token).to.equal('NEAR');
    });

    it('can be asked to try again', async () => {
        const calls = stalling();
        await fetchHistoricalPricesFromArizGateway({ baseToken: 'NEAR', currency: 'NOK' }).catch(() => { });
        resetPriceService();
        expect(priceServiceStatus()).to.equal(null);
        await fetchHistoricalPricesFromArizGateway({ baseToken: 'NEAR', currency: 'NOK' }).catch(() => { });
        expect(calls()).to.equal(2);
    });

    // A token that genuinely has no price must not close the door on the rest.
    it('leaves the door open when the failure is about one token', async () => {
        let calls = 0;
        globalThis.fetch = async () => { calls++; throw new Error('404 Not Found: no such token'); };
        for (const token of ['SCAM', 'ALSOSCAM']) {
            await fetchHistoricalPricesFromArizGateway({ baseToken: token, currency: 'NOK' }).catch(() => { });
        }
        expect(calls).to.equal(2);
        expect(priceServiceStatus()).to.equal(null);
    });
});

// The bearer token lasts under an hour. When it expires, asking for a price
// would put a wallet QR code on screen and wait for a phone — for work nobody
// requested. A real page sat on "Reading NEAR (1 of 46)" doing exactly that:
// idle, no pending request, no error, and no hint on screen.
describe('when the token has expired', () => {
    let realFetch;
    beforeEach(() => {
        realFetch = globalThis.fetch;
        mockWalletAuthenticationData();
        localStorage.removeItem(ACCESS_TOKEN_SESSION_STORAGE_KEY);
        resetPriceService();
    });
    afterEach(() => {
        globalThis.fetch = realFetch;
        localStorage.removeItem(ACCESS_TOKEN_SESSION_STORAGE_KEY);
        resetPriceService();
    });

    it('asks for a signature instead of opening a wallet dialog', async () => {
        let calls = 0;
        globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({}) }; };
        let name = '';
        await fetchHistoricalPricesFromArizGateway({ baseToken: 'NEAR', currency: 'NOK' })
            .catch(e => { name = e.name; });
        expect(name).to.equal('SignatureRequiredError');
        expect(calls).to.equal(0);
    });

    it('says it needs a signature, not that the service is down', async () => {
        globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
        await fetchHistoricalPricesFromArizGateway({ baseToken: 'NEAR', currency: 'NOK' }).catch(() => { });
        expect(priceServiceStatus().kind).to.equal('needs-signature');
    });

    it('does not ask again for every other token', async () => {
        globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
        const names = [];
        for (const token of ['NEAR', 'BTC', 'SOL']) {
            await fetchHistoricalPricesFromArizGateway({ baseToken: token, currency: 'NOK' })
                .catch(e => names.push(e.name));
        }
        expect(names).to.deep.equal(['SignatureRequiredError', 'SignatureRequiredError', 'SignatureRequiredError']);
    });
});

// getEODPriceMap used to catch these itself, log, and return an empty map. Every
// caller that wanted to tell the user their session had expired was therefore
// dead code — and a real token whose history is not synced yet came back
// indistinguishable from one with no market, so its movements were dropped in
// silence.
describe('what getEODPriceMap does with an unreachable service', () => {
    let realFetch;
    beforeEach(() => {
        realFetch = globalThis.fetch;
        mockWalletAuthenticationData();
        localStorage.removeItem(ACCESS_TOKEN_SESSION_STORAGE_KEY);
        resetPriceService();
    });
    afterEach(() => {
        globalThis.fetch = realFetch;
        localStorage.removeItem(ACCESS_TOKEN_SESSION_STORAGE_KEY);
        resetPriceService();
    });

    it('lets a signature error reach the caller', async () => {
        globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
        let name = '';
        await getEODPriceMap('nok', 'NEVERSYNCED').catch(e => { name = e.name; });
        expect(name).to.equal('SignatureRequiredError');
    });

    it('lets an unreachable gateway reach the caller', async () => {
        localStorage.setItem(ACCESS_TOKEN_SESSION_STORAGE_KEY,
            JSON.stringify({ token: 'fresh', accountId: 'test.near', issuedAt: Date.now() }));
        globalThis.fetch = async () => {
            const e = new Error('The operation was aborted due to timeout');
            e.name = 'TimeoutError';
            throw e;
        };
        let name = '';
        await getEODPriceMap('nok', 'NEVERSYNCED2').catch(e => { name = e.name; });
        expect(name).to.equal('PriceServiceNotAnsweringError');
    });

    // A token that genuinely has no market must still come back empty rather
    // than throwing, or every scam airdrop would take the report down.
    it('still answers empty when the token simply has no price', async () => {
        localStorage.setItem(ACCESS_TOKEN_SESSION_STORAGE_KEY,
            JSON.stringify({ token: 'fresh', accountId: 'test.near', issuedAt: Date.now() }));
        globalThis.fetch = async () => ({ ok: false, status: 404, statusText: 'Not Found', text: async () => 'no such token' });
        expect(await getEODPriceMap('nok', 'SCAMTOKEN2')).to.deep.equal({});
    });
});

// The latch had no way to open again inside a session: the user signed in, ran
// the report, and met the same refusal until they reloaded the page.
describe('reopening after the reason has gone', () => {
    let realFetch;
    beforeEach(() => {
        realFetch = globalThis.fetch;
        mockWalletAuthenticationData();
        localStorage.removeItem(ACCESS_TOKEN_SESSION_STORAGE_KEY);
        resetPriceService();
    });
    afterEach(() => {
        globalThis.fetch = realFetch;
        localStorage.removeItem(ACCESS_TOKEN_SESSION_STORAGE_KEY);
        resetPriceService();
    });

    it('tries again once a signature has been given', async () => {
        let calls = 0;
        globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({}) }; };

        await fetchHistoricalPricesFromArizGateway({ baseToken: 'NEAR', currency: 'NOK' }).catch(() => { });
        expect(priceServiceStatus().kind).to.equal('needs-signature');
        expect(calls).to.equal(0);

        // Signing in anywhere caches a token; the latch should notice.
        localStorage.setItem(ACCESS_TOKEN_SESSION_STORAGE_KEY,
            JSON.stringify({ token: 'fresh', accountId: 'test.near', issuedAt: Date.now() }));
        await fetchHistoricalPricesFromArizGateway({ baseToken: 'NEAR', currency: 'NOK' }).catch(() => { });
        expect(calls).to.equal(1);
        expect(priceServiceStatus()).to.equal(null);
    });

    // A gateway that did not answer is not fixed by signing in, so that one
    // stays shut until something asks for a retry.
    it('stays shut when the service was the problem', async () => {
        localStorage.setItem(ACCESS_TOKEN_SESSION_STORAGE_KEY,
            JSON.stringify({ token: 'fresh', accountId: 'test.near', issuedAt: Date.now() }));
        let calls = 0;
        globalThis.fetch = async () => {
            calls++;
            const e = new Error('The operation was aborted due to timeout');
            e.name = 'TimeoutError';
            throw e;
        };
        await fetchHistoricalPricesFromArizGateway({ baseToken: 'NEAR', currency: 'NOK' }).catch(() => { });
        await fetchHistoricalPricesFromArizGateway({ baseToken: 'BTC', currency: 'NOK' }).catch(() => { });
        expect(calls).to.equal(1);

        resetPriceService();
        await fetchHistoricalPricesFromArizGateway({ baseToken: 'BTC', currency: 'NOK' }).catch(() => { });
        expect(calls).to.equal(2);
    });
});
