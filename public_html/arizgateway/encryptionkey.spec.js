import {
    ACCESS_TOKEN_SESSION_STORAGE_KEY,
    __setTestWallet,
} from './arizgatewayaccess.js';
import {
    obtainDek, enrollWithExportedKey, deriveKeyMaterial,
    wrapDek, unwrapDek, currentDekHex, __clearDekForTests,
    bytesToHex, hexToBytes,
    NeedsEnrollmentError, NonDeterministicSignerError, DEK_BYTES,
} from './encryptionkey.js';
import { fakeWallet, mockStore } from './encryptionkey.mock.js';

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
