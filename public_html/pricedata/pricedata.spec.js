import { getEODPrice, fetchNEARHistoricalPrices } from "./pricedata.js";

describe('pricedata', () => {
    it('should get price data for day', async function() {
        await fetchNEARHistoricalPrices();
        expect(await getEODPrice('USD', '2024-01-01')).to.equal(3.65425834);
    });
});
