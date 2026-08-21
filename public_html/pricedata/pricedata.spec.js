import { getEODPrice, getEODPriceMap, fetchHistoricalPricesFromArizGateway, clearPriceHistoryCache, __resetNoPriceTokens } from "./pricedata.js";
import { mockWalletAuthenticationData, mockArizGatewayAccess } from "../arizgateway/arizgatewayaccess.spec.js";

describe('pricedata from Ariz gateway', () => {
    before(async function () {
        mockWalletAuthenticationData();
        await mockArizGatewayAccess();
    });
    it('should get NOK NEAR price data for day', async function () {
        await fetchHistoricalPricesFromArizGateway({currency: 'NOK', todate: '2024-05-30'});

        expect(await getEODPrice('NOK', '2021-02-23')).to.be.closeTo(32.04, 0.1);
        expect(await getEODPrice('NOK', '2022-01-16')).to.be.closeTo(169.67, 0.7);
        expect(await getEODPrice('NOK', '2023-12-25')).to.be.closeTo(38.79, 0.2);
        expect(await getEODPrice('NOK', '2023-12-27')).to.be.closeTo(43.64, 0.1);
        expect(await getEODPrice('NOK', '2024-02-29')).to.be.closeTo(41.2, 0.1);
        expect(await getEODPrice('NOK', '2024-03-01')).to.be.closeTo(41.1, 0.2);
        expect(await getEODPrice('NOK', '2024-03-26')).to.be.closeTo(79.92, 0.05);
    });
    it('should get price data for day', async function () {
        await fetchHistoricalPricesFromArizGateway({currency: 'USD', todate: '2024-05-30'});
        expect(await getEODPrice('USD', '2024-01-01')).to.be.closeTo(3.65425834, 0.00001);
    });
    it('loads a missing price automatically, without prompting', async function () {
        // GOODTOKEN is not in the gateway no-price set and has history available.
        // It must load silently - no "fetch price data?" modal.
        __resetNoPriceTokens();
        expect(await getEODPrice('NOK', '2024-01-01', 'GOODTOKEN')).to.be.closeTo(1.23, 0.0001);
        expect(document.querySelector('common-modal')).to.equal(null);
    });
    it('returns 0 without prompting for a token the gateway reports as having no price', async function () {
        // Gateway /api/prices/nopricetokens returns ["scamtoken"] (cached fixture).
        __resetNoPriceTokens();
        expect(await getEODPrice('NOK', '2024-01-01', 'SCAMTOKEN')).to.equal(0);
        expect(document.querySelector('common-modal')).to.equal(null);
    });
    it('treats an unknown token whose history comes back empty as unavailable, and does not refetch', async function () {
        // Not in the no-price set yet: it auto-fetches once (no prompt), gets an
        // empty history, returns 0, and the next date must not fetch again.
        __resetNoPriceTokens();
        expect(await getEODPrice('NOK', '2024-01-01', 'NEWSCAM')).to.equal(0);
        expect(await getEODPrice('NOK', '2024-01-02', 'NEWSCAM')).to.equal(0);
        expect(document.querySelector('common-modal')).to.equal(null);
    });
});

describe('price history is merged, never replaced', () => {
    before(async function () {
        mockWalletAuthenticationData();
        await mockArizGatewayAccess();
    });

    // A single missing date triggers a whole-history fetch, and the gateway
    // answers with whatever its own cache holds for that token — which can be far
    // less than what is already stored locally. Overwriting cost one real store
    // 4 252 days of BTC history, replaced by 19, the first time a 2026 BTC
    // transaction asked for a date the local file did not have.
    it('keeps dates the gateway did not return', async function () {
        const { getHistoricalPriceData, setHistoricalPriceData } =
            await import('../storage/domainobjectstore.js');

        const deepHistory = { '2014-07-18': 100, '2019-01-01': 200, '2024-01-01': 300 };
        await setHistoricalPriceData('NEAR', 'NOK', deepHistory);

        // The mocked gateway answers with its own (recent) window.
        await fetchHistoricalPricesFromArizGateway({ currency: 'NOK', todate: '2024-05-30' });

        const after = await getHistoricalPriceData('NEAR', 'NOK');
        for (const [date, price] of Object.entries(deepHistory)) {
            expect(after[date], `lost ${date}`).to.equal(price);
        }
        // And it did gain whatever the gateway had.
        expect(Object.keys(after).length).to.be.greaterThan(Object.keys(deepHistory).length);
    });

    it('is idempotent — a second fetch changes nothing', async function () {
        const { getHistoricalPriceData } = await import('../storage/domainobjectstore.js');
        await fetchHistoricalPricesFromArizGateway({ currency: 'NOK', todate: '2024-05-30' });
        const first = await getHistoricalPriceData('NEAR', 'NOK');
        await fetchHistoricalPricesFromArizGateway({ currency: 'NOK', todate: '2024-05-30' });
        const second = await getHistoricalPriceData('NEAR', 'NOK');
        expect(second).to.deep.equal(first);
    });
});

// A report asks for one date at a time out of a file holding every date. Summed
// over every token for a year that is thousands of reads of the same file, so the
// parse is held for the session.
describe('a price history is read once per session', () => {
    before(async function () {
        mockWalletAuthenticationData();
        await mockArizGatewayAccess();
        clearPriceHistoryCache();
    });

    it('serves later dates without re-reading storage', async function () {
        const { setHistoricalPriceData } = await import('../storage/domainobjectstore.js');
        await setHistoricalPriceData('CACHED', 'NOK', { '2024-01-01': 10, '2024-01-02': 20 });
        clearPriceHistoryCache();

        expect(await getEODPrice('NOK', '2024-01-01', 'CACHED')).to.equal(10);

        // Written behind the cache's back. Still the cached parse, because that is
        // what "read once" means — and why the writer has to invalidate.
        await setHistoricalPriceData('CACHED', 'NOK', { '2024-01-01': 999, '2024-01-02': 999 });
        expect(await getEODPrice('NOK', '2024-01-02', 'CACHED')).to.equal(20);

        clearPriceHistoryCache();
        expect(await getEODPrice('NOK', '2024-01-02', 'CACHED')).to.equal(999);
    });

    // The same object now goes to every caller, so one that wrote into it would
    // change what every later reader sees. Frozen, it throws at the write instead.
    it('hands out a history that cannot be written into', async function () {
        const { setHistoricalPriceData } = await import('../storage/domainobjectstore.js');
        await setHistoricalPriceData('FROZEN', 'NOK', { '2024-01-01': 10 });
        clearPriceHistoryCache();

        const map = await getEODPriceMap('NOK', 'FROZEN');
        expect(() => { map['2024-01-01'] = 0; }).to.throw();
    });
});
