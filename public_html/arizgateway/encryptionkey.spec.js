import {
    ACCESS_TOKEN_SESSION_STORAGE_KEY,
    __setTestWallet,
    arizgatewayhost,
} from './arizgatewayaccess.js';
import {
    obtainDek, enrollWithExportedKey, deriveKeyMaterial,
    wrapDek, unwrapDek, currentDekHex, __clearDekForTests,
    bytesToHex, hexToBytes,
    NeedsEnrollmentError, NonDeterministicSignerError, DEK_BYTES,
} from './encryptionkey.js';

// Deterministic fake wallet: a fixed fake "signature" per (accountId, message,
// recipient) — enough for derivation, which never verifies signatures.
function fakeWallet(accountId, { hedged = false } = {}) {
    let counter = 0;
    __setTestWallet({
        accountId,
        async getAccounts() { return [{ accountId }]; },
        async signMessage({ message, recipient }) {
            const seed = `${accountId}|${recipient}|${message}${hedged ? `|${counter++}` : ''}`;
            const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed)));
            const sig = new Uint8Array(64);
            sig.set(bytes); sig.set(bytes, 32);
            return {
                accountId,
                publicKey: 'ed25519:CziSGowWUKiP5N5pqGUgXCJXtqpySAk29YAU6zEs5RAi',
                signature: btoa(String.fromCharCode(...sig)),
            };
        },
        async signOut() {},
    });
}

// In-memory mock of the gateway's /store/me wraps + refs-probe endpoints.
function mockStore() {
    const state = { wraps: new Map(), refsExists: false, unauthorized: false };
    const realFetch = window.fetch;
    window.fetch = async (url, init = {}) => {
        const u = String(url);
        if (!u.startsWith(`${arizgatewayhost}/store/me`)) return realFetch(url, init);
        if (state.unauthorized) return new Response('failed to parse token', { status: 401 });
        const path = u.slice(`${arizgatewayhost}/store/me`.length);
        if (path === '/refs') {
            return state.refsExists
                ? new Response(new Uint8Array([1]), { status: 200 })
                : new Response('{"error":"not found"}', { status: 404 });
        }
        const wrapMatch = path.match(/^\/keys\/([0-9a-f]{32})$/);
        if (wrapMatch) {
            const id = wrapMatch[1];
            if ((init.method ?? 'GET') === 'GET') {
                const wrap = state.wraps.get(id);
                return wrap
                    ? new Response(wrap, { status: 200 })
                    : new Response('{"error":"not found"}', { status: 404 });
            }
            if (init.method === 'PUT') {
                if (state.wraps.has(id)) return new Response('{"error":"wrap already exists"}', { status: 412 });
                state.wraps.set(id, new Uint8Array(await new Response(init.body).arrayBuffer()));
                return new Response(null, { status: 204 });
            }
        }
        return new Response('unexpected', { status: 500 });
    };
    state.restore = () => { window.fetch = realFetch; };
    return state;
}

describe('encryptionkey (wrapped-DEK wallet unlock)', () => {
    let store;

    beforeEach(() => {
        __clearDekForTests();
        // Seed a fresh cached auth token so getAccessToken never re-signs (keeps
        // the signature counting in these specs to derivation signatures only).
        localStorage.setItem(ACCESS_TOKEN_SESSION_STORAGE_KEY,
            JSON.stringify({ token: 'test-token', accountId: 'alice.near', issuedAt: Date.now() }));
        store = mockStore();
    });

    afterEach(() => {
        store.restore();
        __setTestWallet(null);
        localStorage.removeItem(ACCESS_TOKEN_SESSION_STORAGE_KEY);
    });

    it('derivation is deterministic and account/recipient-scoped', async () => {
        fakeWallet('alice.near');
        const a = await deriveKeyMaterial();
        const b = await deriveKeyMaterial();
        expect(bytesToHex(a.kek)).to.equal(bytesToHex(b.kek));
        expect(a.wrapId).to.equal(b.wrapId);
        expect(a.wrapId).to.match(/^[0-9a-f]{32}$/);
        // KEK and wrapId must not be trivially related.
        expect(bytesToHex(a.kek)).to.not.contain(a.wrapId);

        fakeWallet('bob.near');
        const c = await deriveKeyMaterial();
        expect(c.wrapId).to.not.equal(a.wrapId);
    });

    it('rejects a non-deterministic (hedged) signer', async () => {
        fakeWallet('alice.near', { hedged: true });
        try {
            await deriveKeyMaterial();
            expect.fail('should have thrown');
        } catch (e) {
            expect(e).to.be.instanceOf(NonDeterministicSignerError);
        }
    });

    it('wrap/unwrap round-trips and rejects a wrong KEK', async () => {
        const kek = crypto.getRandomValues(new Uint8Array(32));
        const dek = crypto.getRandomValues(new Uint8Array(DEK_BYTES));
        const wrap = await wrapDek(kek, dek);
        expect(bytesToHex(await unwrapDek(kek, wrap))).to.equal(bytesToHex(dek));
        let failed = false;
        await unwrapDek(crypto.getRandomValues(new Uint8Array(32)), wrap).catch(() => { failed = true; });
        expect(failed).to.equal(true);
    });

    it('first setup: mints a DEK and stores a wrap; second session unlocks the same DEK', async () => {
        fakeWallet('alice.near');
        const dek1 = await obtainDek();
        expect(dek1.length).to.equal(DEK_BYTES);
        expect(store.wraps.size).to.equal(1);

        __clearDekForTests(); // "new session", same wallet
        const dek2 = await obtainDek();
        expect(bytesToHex(dek2)).to.equal(bytesToHex(dek1));
        expect(store.wraps.size).to.equal(1);
    });

    it('a second wallet key on an existing store needs enrollment, then unlocks by signing', async () => {
        fakeWallet('alice.near');
        const dek = await obtainDek();
        store.refsExists = true; // the first device has pushed data

        __clearDekForTests();
        fakeWallet('alice-ledger.near'); // different signer -> different KEK/wrapId
        try {
            await obtainDek();
            expect.fail('should have required enrollment');
        } catch (e) {
            expect(e).to.be.instanceOf(NeedsEnrollmentError);
        }

        // Enroll with the exported key -> a second wrap; from now on signing works.
        await enrollWithExportedKey(bytesToHex(dek));
        expect(store.wraps.size).to.equal(2);

        __clearDekForTests();
        expect(bytesToHex(await obtainDek())).to.equal(bytesToHex(dek));
        expect(currentDekHex()).to.equal(bytesToHex(dek));
    });

    it('first-setup race: the losing PUT re-fetches and unwraps the winner\'s DEK', async () => {
        fakeWallet('alice.near');
        // Pre-store a wrap for alice's wrapId as if another tab/device just won.
        const { kek, wrapId } = await deriveKeyMaterial();
        const winnerDek = crypto.getRandomValues(new Uint8Array(DEK_BYTES));
        store.wraps.set(wrapId, await wrapDek(kek, winnerDek));

        const dek = await obtainDek();
        expect(bytesToHex(dek)).to.equal(bytesToHex(winnerDek));
        expect(store.wraps.size).to.equal(1);
    });

    it('enrolling a mismatched exported key against an existing wrap is rejected', async () => {
        fakeWallet('alice.near');
        await obtainDek(); // creates alice's wrap
        __clearDekForTests();
        let message = '';
        await enrollWithExportedKey(bytesToHex(crypto.getRandomValues(new Uint8Array(DEK_BYTES))))
            .catch((e) => { message = e.message; });
        expect(message).to.contain('does not match');
    });

    it('hexToBytes/bytesToHex round-trip', () => {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        expect(bytesToHex(hexToBytes(bytesToHex(bytes)))).to.equal(bytesToHex(bytes));
    });
});
