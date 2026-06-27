import { getEODPrice, fetchHistoricalPricesFromArizGateway, __resetNoPriceTokens } from "./pricedata.js";
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
