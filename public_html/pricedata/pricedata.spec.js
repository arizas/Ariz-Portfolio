import { getEODPrice, fetchNEARHistoricalPrices, fetchNOKPrices } from "./pricedata.js";

describe('pricedata', () => {
    it('should get price data for day', async function () {
        await fetchNEARHistoricalPrices();
        expect(await getEODPrice('USD', '2024-01-01')).to.equal(3.65425834);
    });

    it('should get NOK price data for day', async function () {
        await fetchNEARHistoricalPrices();
        await fetchNOKPrices();
        expect(await getEODPrice('NOK', '2021-02-23')).to.be.closeTo(32.04, 0.1);
        expect(await getEODPrice('NOK', '2022-01-16')).to.be.closeTo(169.67, 0.7);
        expect(await getEODPrice('NOK', '2023-12-25')).to.be.closeTo(38.79, 0.2);
        expect(await getEODPrice('NOK', '2023-12-27')).to.be.closeTo(43.64, 0.1);
        expect(await getEODPrice('NOK', '2024-02-29')).to.be.closeTo(41.2, 0.1);
        expect(await getEODPrice('NOK', '2024-03-01')).to.be.closeTo(41.1, 0.2);
        expect(await getEODPrice('NOK', '2024-03-26')).to.be.closeTo(79.92, 0.05);
    });
});
