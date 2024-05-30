import { getEODPrice, fetchHistoricalPricesFromCoinGecko, fetchNEARHistoricalPricesFromNearBlocks, fetchNOKPrices } from "./pricedata.js";

describe('pricedata', () => {
    it('should get price data for day', async function () {
        await fetchNEARHistoricalPricesFromNearBlocks();
        expect(await getEODPrice('USD', '2024-01-01')).to.equal(3.65425834);
    });

    it('should get NOK price data for day', async function () {
        await fetchNEARHistoricalPricesFromNearBlocks();
        await fetchNOKPrices();
        expect(await getEODPrice('NOK', '2021-02-23')).to.be.closeTo(32.04, 0.1);
        expect(await getEODPrice('NOK', '2022-01-16')).to.be.closeTo(169.67, 0.7);
        expect(await getEODPrice('NOK', '2023-12-25')).to.be.closeTo(38.79, 0.2);
        expect(await getEODPrice('NOK', '2023-12-27')).to.be.closeTo(43.64, 0.1);
        expect(await getEODPrice('NOK', '2024-02-29')).to.be.closeTo(41.2, 0.1);
        expect(await getEODPrice('NOK', '2024-03-01')).to.be.closeTo(41.1, 0.2);
        expect(await getEODPrice('NOK', '2024-03-26')).to.be.closeTo(79.92, 0.05);
    });
    it('should get USD NOK exchange rate for day', async function () {
        await fetchNEARHistoricalPrices();
        await fetchNOKPrices();
        expect(await getEODPrice('NOK', '2021-02-23', 'USDT.e')).to.be.closeTo(8.4979, 0.1);
        expect(await getEODPrice('NOK', '2022-01-16', 'USDC.e')).to.be.closeTo(8.7239, 0.7);
        expect(await getEODPrice('NOK', '2023-12-25', 'USDT')).to.be.closeTo(10.2245, 0.2);
        expect(await getEODPrice('NOK', '2023-12-27', 'USDC')).to.be.closeTo(10.1541, 0.1);
        expect(await getEODPrice('NOK', '2023-02-28', 'USN')).to.be.closeTo(10.3318, 0.1);
        expect(await getEODPrice('NOK', '2024-02-29', 'USDC')).to.be.closeTo(10.6152, 0.1);
    });
});

describe.only('pricedata from coingecko', () => {
    it('should get NOK NEAR price data for day', async function () {
        await fetchHistoricalPricesFromCoinGecko({currency: 'NOK', todate: new Date(2024,4,30).toJSON()});

        expect(await getEODPrice('NOK', '2021-02-23')).to.be.closeTo(32.04, 0.1);
        expect(await getEODPrice('NOK', '2022-01-16')).to.be.closeTo(169.67, 0.7);
        expect(await getEODPrice('NOK', '2023-12-25')).to.be.closeTo(38.79, 0.2);
        expect(await getEODPrice('NOK', '2023-12-27')).to.be.closeTo(43.64, 0.1);
        expect(await getEODPrice('NOK', '2024-02-29')).to.be.closeTo(41.2, 0.1);
        expect(await getEODPrice('NOK', '2024-03-01')).to.be.closeTo(41.1, 0.2);
        expect(await getEODPrice('NOK', '2024-03-26')).to.be.closeTo(79.92, 0.05);
    });
    it('should get price data for day', async function () {
        await fetchHistoricalPricesFromCoinGecko({currency: 'USD', todate: new Date(2024,4,30).toJSON()});
        expect(await getEODPrice('USD', '2024-01-01')).to.be.closeTo(3.65425834, 0.00001);
    });

});