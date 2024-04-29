import './storage-page.component.js';
import {getHistoricalPriceData} from './domainobjectstore.js';

describe('storage-page component', () => {
    it("should be able to fetch price data when not logged in", async () => {
        const storagePageComponent = document.createElement('storage-page');
        document.body.appendChild(storagePageComponent);

        storagePageComponent.shadowRoot.getElementById('fetchnearusdbutton').click();

        expect((await getHistoricalPriceData('', 'USD'))['2020-11-02']).to.equal(0.63411456);        
    });
});