import {
    ACCESS_TOKEN_SESSION_STORAGE_KEY,
    __setTestWallet,
    getAccessToken,
    isSignedIn,
} from './arizgatewayaccess.js';

// Inject a fake @hot-labs/near-connect wallet so specs can exercise the
// signed-in code paths without a real wallet session. It produces a
// NEP-413-shaped signed message (accountId / publicKey / signature).
export function mockWalletAuthenticationData(accountId = 'test.near') {
    __setTestWallet({
        accountId,
        async getAccounts() {
            return [{ accountId }];
        },
        async signMessage({ message, recipient, nonce }) {
            return {
                accountId,
                publicKey: 'ed25519:CziSGowWUKiP5N5pqGUgXCJXtqpySAk29YAU6zEs5RAi',
                // 64-byte zero signature, base64 — fine for frontend tests; the
                // real gateway verifies signatures, but it isn't exercised here.
                signature: btoa(String.fromCharCode(...new Uint8Array(64))),
            };
        },
        async signOut() {},
    });
}

// Build and cache a gateway access token using the mocked wallet.
export async function mockArizGatewayAccess() {
    await getAccessToken();
}

describe('arizgatewayaccess (NEP-413)', () => {
    beforeEach(() => {
        localStorage.removeItem(ACCESS_TOKEN_SESSION_STORAGE_KEY);
        __setTestWallet(null);
    });

    it('builds a NEP-413 bearer token and caches it', async () => {
        mockWalletAuthenticationData('alice.near');
        const token = await getAccessToken();

        const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(token), c => c.charCodeAt(0))));
        expect(payload.accountId).to.equal('alice.near');
        expect(payload.recipient).to.equal('arizportfolio.near');
        expect(payload.publicKey).to.match(/^ed25519:/);
        expect(typeof payload.signature).to.equal('string');
        expect(JSON.parse(payload.message)).to.have.property('issuedAt');

        const cached = JSON.parse(localStorage.getItem(ACCESS_TOKEN_SESSION_STORAGE_KEY));
        expect(cached.token).to.equal(token);
        expect(cached.accountId).to.equal('alice.near');
    });

    it('reuses the cached token on the next call (no re-sign)', async () => {
        mockWalletAuthenticationData('alice.near');
        const first = await getAccessToken();
        // Drop the wallet: a re-sign would now throw, so a second token proves caching.
        __setTestWallet(null);
        const second = await getAccessToken();
        expect(second).to.equal(first);
    });

    it('isSignedIn is true with a fresh cached token, false after logout clears it', async () => {
        mockWalletAuthenticationData('alice.near');
        await getAccessToken();
        expect(await isSignedIn()).to.equal(true);

        localStorage.removeItem(ACCESS_TOKEN_SESSION_STORAGE_KEY);
        __setTestWallet(null);
        expect(await isSignedIn()).to.equal(false);
    });
});
