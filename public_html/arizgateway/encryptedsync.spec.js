import {
    ACCESS_TOKEN_SESSION_STORAGE_KEY,
    __setTestWallet,
    arizgatewayhost,
} from './arizgatewayaccess.js';
import { __clearDekForTests, currentDekHex, NeedsEnrollmentError } from './encryptionkey.js';
import { fakeWallet, mockStore } from './encryptionkey.mock.js';
import {
    registerEgitServiceWorker, configureEgitKey, encryptedRemoteUrl,
    isEncryptedSyncEnabled, setEncryptedSyncEnabled, ENCRYPTED_SYNC_ENABLED_KEY,
    pageIsControlled, waitForController,
    __setTestServiceWorkerContainer,
} from './encryptedsync.js';
import { fakeSwContainer } from './encryptedsync.mock.js';

describe('encryptedsync (service worker registration + egit-set-key wiring)', () => {
    let store;
    let sw;

    const seedToken = (token) => localStorage.setItem(ACCESS_TOKEN_SESSION_STORAGE_KEY,
        JSON.stringify({ token, accountId: 'alice.near', issuedAt: Date.now() }));

    beforeEach(() => {
        __clearDekForTests();
        seedToken('test-token');
        store = mockStore();
        sw = fakeSwContainer();
        __setTestServiceWorkerContainer(sw);
        fakeWallet('alice.near');
    });

    afterEach(() => {
        store.restore();
        __setTestWallet(null);
        __setTestServiceWorkerContainer(null);
        localStorage.removeItem(ACCESS_TOKEN_SESSION_STORAGE_KEY);
    });

    it('registers /sw.js as a module service worker at scope /', async () => {
        await registerEgitServiceWorker();
        expect(sw.registerCalls.length).to.equal(1);
        expect(sw.registerCalls[0].url).to.equal('/sw.js');
        expect(sw.registerCalls[0].options).to.deep.equal({ type: 'module', scope: '/' });
    });

    it('retries registration through transient failures (near.page 400s)', async () => {
        sw = fakeSwContainer({ failures: 2 });
        __setTestServiceWorkerContainer(sw);
        const registration = await registerEgitServiceWorker({ retryDelayMs: 1 });
        expect(sw.registerCalls.length).to.equal(3);
        expect(registration.active).to.equal(sw.active);
    });

    it('gives up after the configured attempts and reports the last error', async () => {
        sw = fakeSwContainer({ failures: Infinity });
        __setTestServiceWorkerContainer(sw);
        let message = '';
        await registerEgitServiceWorker({ attempts: 2, retryDelayMs: 1 }).catch((e) => { message = e.message; });
        expect(sw.registerCalls.length).to.equal(2);
        expect(message).to.contain('2 attempts');
        expect(message).to.contain('400');
    });

    it('configureEgitKey sends the key, store URL and bearer token, and awaits the ack', async () => {
        const { repoId, remoteUrl } = await configureEgitKey();
        expect(repoId).to.equal('alice.near');
        expect(remoteUrl).to.equal(`${location.origin}/egit/alice.near`);

        expect(sw.active.messages.length).to.equal(1);
        const msg = sw.active.messages[0];
        expect(msg.type).to.equal('egit-set-key');
        expect(msg.repoId).to.equal('alice.near');
        expect(msg.keyHex).to.match(/^[0-9a-f]{64}$/);
        expect(msg.keyHex).to.equal(currentDekHex());
        expect(msg.storeBaseUrl).to.equal(`${arizgatewayhost}/store/me`);
        expect(msg.headers).to.deep.equal({ Authorization: 'Bearer test-token' });
    });

    it('re-sending picks up a refreshed token but keeps the same key', async () => {
        await configureEgitKey();
        seedToken('refreshed-token');
        await configureEgitKey();

        expect(sw.active.messages.length).to.equal(2);
        const [first, second] = sw.active.messages;
        expect(second.headers).to.deep.equal({ Authorization: 'Bearer refreshed-token' });
        expect(second.keyHex).to.equal(first.keyHex);
        // still only the one wrap from first setup — no new DEK was minted
        expect(store.wraps.size).to.equal(1);
    });

    it('requires the WALLET, not just a fresh cached token (token outlives the session)', async () => {
        // Cached token is fresh (seeded in beforeEach) but the wallet session
        // is gone (no accounts even after a reconnect attempt) —
        // configureEgitKey must fail asking for the wallet, NOT silently use
        // the token, and must not touch the service worker.
        __setTestWallet({
            async getAccounts() { return []; },
            async signMessage() { throw new Error('no wallet session'); },
            async signOut() { },
        });
        let message = '';
        await configureEgitKey().catch((e) => { message = e.message; });
        expect(message).to.contain('connect your NEAR wallet');
        expect(sw.active.messages.length).to.equal(0);
    });

    it('propagates NeedsEnrollmentError without configuring the service worker', async () => {
        store.refsExists = true; // data exists, but this wallet key has no wrap
        let error = null;
        await configureEgitKey().catch((e) => { error = e; });
        expect(error).to.be.instanceOf(NeedsEnrollmentError);
        expect(sw.active.messages.length).to.equal(0);
    });

    it('encryptedRemoteUrl targets /egit/<account> on this origin', () => {
        expect(encryptedRemoteUrl('bob.near')).to.equal(`${location.origin}/egit/bob.near`);
    });

    it('the encrypted-sync opt-in flag toggles and defaults to off', () => {
        localStorage.removeItem(ENCRYPTED_SYNC_ENABLED_KEY);
        expect(isEncryptedSyncEnabled()).to.equal(false);
        setEncryptedSyncEnabled(true);
        expect(isEncryptedSyncEnabled()).to.equal(true);
        setEncryptedSyncEnabled(false);
        expect(isEncryptedSyncEnabled()).to.equal(false);
        expect(localStorage.getItem(ENCRYPTED_SYNC_ENABLED_KEY)).to.equal(null);
    });

    it('waitForController resolves when the service worker claims the page', async () => {
        sw = fakeSwContainer({ controlled: false });
        __setTestServiceWorkerContainer(sw);
        expect(pageIsControlled()).to.equal(false);
        const waiting = waitForController();
        sw.claim();
        expect(await waiting).to.equal(true);
        expect(pageIsControlled()).to.equal(true);
    });

    it('waitForController resolves immediately on an already-controlled page', async () => {
        expect(await waitForController()).to.equal(true);
    });
});
