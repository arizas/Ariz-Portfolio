import nearApi from 'near-api-js';
import { useAccount, createAccessToken } from './storage-page.component.js';

describe('storage-page component', () => {
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
