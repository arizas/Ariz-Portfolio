import {
    ACCESS_TOKEN_SESSION_STORAGE_KEY,
    __setTestWallet,
    arizgatewayhost,
} from './arizgatewayaccess.js';
import { __clearDekForTests, currentDekHex, NeedsEnrollmentError } from './encryptionkey.js';
import { fakeWallet, mockStore } from './encryptionkey.mock.js';
import {
    registerEgitServiceWorker, configureEgitKey, encryptedRemoteUrl,
    __setTestServiceWorkerContainer,
} from './encryptedsync.js';

// Fake ServiceWorkerContainer: register() fails `failures` times before
// succeeding (near.page's transient 400s), and the active worker records
// egit-set-key messages and acks on the transferred port like the real SW.
function fakeSwContainer({ failures = 0, ack = true } = {}) {
    const active = {
        messages: [],
        postMessage(message, transfer) {
            this.messages.push(message);
            if (ack) transfer?.[0]?.postMessage({ type: 'egit-key-set', repoId: message.repoId });
        },
    };
    return {
        active,
        registerCalls: [],
        async register(url, options) {
            this.registerCalls.push({ url, options });
            if (this.registerCalls.length <= failures) {
                throw new TypeError('Failed to register a ServiceWorker: bad HTTP response code (400)');
            }
            return {};
        },
        get ready() { return Promise.resolve({ active }); },
        controller: active,
    };
}

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
});
