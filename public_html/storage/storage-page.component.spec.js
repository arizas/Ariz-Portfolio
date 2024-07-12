
import { getHistoricalPriceData } from './domainobjectstore.js';
import { mockWalletAuthenticationData, mockArizGatewayAccess } from '../arizgateway/arizgatewayaccess.spec.js';
import './storage-page.component.js';

describe('storage-page component', () => {
    it("should be able to fetch price data when not logged in", async () => {
        mockWalletAuthenticationData();
        await mockArizGatewayAccess();
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