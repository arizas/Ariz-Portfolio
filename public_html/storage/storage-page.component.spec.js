import nearApi from 'near-api-js';
import { getHistoricalPriceData } from './domainobjectstore.js';
import { useAccount, createAccessToken } from './storage-page.component.js';

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
    it('should create an signed access token if an access key is provided', async () => {
        const storagePageComponent = document.createElement('storage-page');
        document.body.appendChild(storagePageComponent);

        const keypair = nearApi.utils.KeyPairEd25519.fromRandom();

        await useAccount('test.near', keypair.secretKey);
        const accessToken = await createAccessToken();
        const accessTokenParts = accessToken.split('.');
        expect(JSON.parse(atob(accessTokenParts[0])).accountId).to.equal('test.near');
    });
});