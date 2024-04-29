import './storage-page.component.js';
import { getHistoricalPriceData } from './domainobjectstore.js';

describe('storage-page component', () => {
    it("should be able to fetch price data when not logged in", async () => {
        const storagePageComponent = document.createElement('storage-page');
        document.body.appendChild(storagePageComponent);

        await storagePageComponent.readyPromise;
        storagePageComponent.shadowRoot.getElementById('fetchnearusdbutton').click();

        let pricedata;
        do {
            pricedata = await getHistoricalPriceData('', 'USD');
        } while (Object.keys(pricedata).length == 0);

        expect(pricedata['2020-11-02']).to.equal(0.63411456);
    });
});