import {
    ACCESS_TOKEN_SESSION_STORAGE_KEY,
    __setTestWallet,
} from '../arizgateway/arizgatewayaccess.js';
import {
    fetchConfidentialHistory,
    buildAuthNonce,
    serializeNep413Payload,
    base58Encode,
    historyItemKey,
    ConfidentialHistoryUnavailableError,
    __resetForTests,
    __setSessionForTests,
} from './intentshistory.js';
import { mockIntentsBackend, signingWallet, historyItem } from './intentshistory.mock.js';

describe('intentshistory (1Click confidential history)', () => {
    let backend;
    let wallet;

    beforeEach(() => {
        __resetForTests();
        // Seed a fresh cached gateway auth token so getAccessToken never
        // re-signs — signature counting below covers 1Click auth only.
        localStorage.setItem(ACCESS_TOKEN_SESSION_STORAGE_KEY,
            JSON.stringify({ token: 'test-token', accountId: 'alice.near', issuedAt: Date.now() }));
        backend = mockIntentsBackend();
        wallet = signingWallet('alice.near');
    });

    afterEach(() => {
        backend.restore();
        __setTestWallet(null);
        localStorage.removeItem(ACCESS_TOKEN_SESSION_STORAGE_KEY);
    });

    const shielding = historyItem({
        createdAt: '2026-07-08T17:48:43.001527Z',
        depositType: 'INTENTS', recipientType: 'CONFIDENTIAL_INTENTS',
        depositAddress: 'aaa1',
    });
    const confidentialSwap = historyItem({
        createdAt: '2026-07-08T18:06:38.646840Z',
        depositType: 'CONFIDENTIAL_INTENTS', recipientType: 'CONFIDENTIAL_INTENTS',
        depositAddress: 'bbb2',
        originAsset: 'nep141:btc.omft.near', destinationAsset: 'nep141:wrap.near',
        amountOutFormatted: '178.700953425886164961421727',
    });
    const laterShielding = historyItem({
        createdAt: '2026-07-09T10:00:00.000000Z',
        depositType: 'INTENTS', recipientType: 'CONFIDENTIAL_INTENTS',
        depositAddress: 'ccc3',
    });
    const unshielding = historyItem({
        createdAt: '2026-07-10T12:00:00.000000Z',
        depositType: 'CONFIDENTIAL_INTENTS', recipientType: 'INTENTS',
        depositAddress: 'ddd4',
    });

    function seedTypicalPages() {
        // Two pages on the recipient query; the deposit query overlaps on the
        // confidential swap (returned by both filters).
        backend.pages = {
            'recipientType=CONFIDENTIAL_INTENTS': [[confidentialSwap, shielding], [laterShielding]],
            'depositType=CONFIDENTIAL_INTENTS': [[unshielding, confidentialSwap]],
        };
    }

    it('fetches the union of the two filtered queries with one wallet signature, deduped and oldest-first', async () => {
        seedTypicalPages();

        const items = await fetchConfidentialHistory();

        expect(items.map((i) => i.depositAddress)).to.deep.equal(['aaa1', 'bbb2', 'ccc3', 'ddd4']);
        expect(backend.authenticateCalls).to.equal(1);
        expect(wallet.signatureCount).to.equal(1);
        // 2 pages + 1 page — pagination followed per filter.
        expect(backend.historyRequests.length).to.equal(3);
    });

    it('signs the exact trezu-style auth payload (message shape, recipient, nonce layout)', async () => {
        seedTypicalPages();
        await fetchConfidentialHistory();

        const { payload } = backend.lastAuthBody.signedData;
        expect(payload.recipient).to.equal('intents.near');
        const message = JSON.parse(payload.message);
        expect(message.signer_id).to.equal('alice.near');
        expect(message.intents).to.deep.equal([]);
        expect(new Date(message.deadline).getTime()).to.be.greaterThan(Date.now());
        // Key order is part of the signed bytes.
        expect(payload.message.startsWith('{"deadline":')).to.equal(true);

        const nonce = Uint8Array.from(atob(payload.nonce), (c) => c.charCodeAt(0));
        expect([...nonce.slice(0, 4)]).to.deep.equal([0x56, 0x28, 0xF6, 0xC6]); // magic
        expect(nonce[4]).to.equal(0); // version
        expect([...nonce.slice(5, 9)]).to.deep.equal([0xaa, 0xbb, 0xcc, 0xdd]); // contract salt
        const deadlineNs = new DataView(nonce.buffer).getBigUint64(9, true);
        expect(Number(deadlineNs / 1_000_000n)).to.equal(new Date(message.deadline).getTime());
    });

    it('retries history requests on server 500s', async () => {
        seedTypicalPages();
        backend.failBeforeSuccess = 2;

        const items = await fetchConfidentialHistory({ retryDelayMs: 1 });

        expect(items.length).to.equal(4);
        expect(backend.historyRequests.length).to.equal(5); // 2 failed + 3 successful
    });

    it('gives up after persistent server 500s', async () => {
        seedTypicalPages();
        backend.failBeforeSuccess = 100;

        let message = '';
        await fetchConfidentialHistory({ retryDelayMs: 1 }).catch((e) => { message = e.message; });
        expect(message).to.contain('1Click history -> 500');
    });

    it('refreshes an expired access token without a wallet signature', async () => {
        seedTypicalPages();
        __setSessionForTests({
            accessToken: 'stale', refreshToken: 'old-refresh',
            accessExpiresAt: Date.now() - 1, refreshExpiresAt: Date.now() + 60_000,
        });

        await fetchConfidentialHistory();

        expect(backend.refreshCalls).to.equal(1);
        expect(backend.authenticateCalls).to.equal(0);
        expect(wallet.signatureCount).to.equal(0);
        expect(backend.historyRequests[0].bearer).to.equal('access-1');
    });

    it('falls back to a fresh wallet signature when the refresh is rejected', async () => {
        seedTypicalPages();
        backend.refreshStatus = 401;
        __setSessionForTests({
            accessToken: 'stale', refreshToken: 'old-refresh',
            accessExpiresAt: Date.now() - 1, refreshExpiresAt: Date.now() + 60_000,
        });

        await fetchConfidentialHistory();

        expect(backend.refreshCalls).to.equal(1);
        expect(backend.authenticateCalls).to.equal(1);
        expect(wallet.signatureCount).to.equal(1);
    });

    it('re-signs directly when the whole session is expired', async () => {
        seedTypicalPages();
        __setSessionForTests({
            accessToken: 'stale', refreshToken: 'dead-refresh',
            accessExpiresAt: Date.now() - 1, refreshExpiresAt: Date.now() - 1,
        });

        await fetchConfidentialHistory();

        expect(backend.refreshCalls).to.equal(0);
        expect(backend.authenticateCalls).to.equal(1);
    });

    it('throws ConfidentialHistoryUnavailableError when the gateway has no API key configured', async () => {
        backend.configStatus = 404;

        let caught = null;
        await fetchConfidentialHistory().catch((e) => { caught = e; });
        expect(caught).to.be.instanceOf(ConfidentialHistoryUnavailableError);
        expect(wallet.signatureCount).to.equal(0);
    });

    it('buildAuthNonce embeds deadline and creation time as little-endian nanoseconds', () => {
        const salt = new Uint8Array([1, 2, 3, 4]);
        const nowMs = 1751980800000;
        const deadlineMs = nowMs + 600_000;
        const nonce = buildAuthNonce(salt, deadlineMs, nowMs);
        const view = new DataView(nonce.buffer);
        expect(view.getBigUint64(9, true)).to.equal(BigInt(deadlineMs) * 1_000_000n);
        expect(view.getBigUint64(17, true)).to.equal(BigInt(nowMs) * 1_000_000n);
        // 7 trailing random bytes differ between nonces.
        const nonce2 = buildAuthNonce(salt, deadlineMs, nowMs);
        expect([...nonce.slice(0, 25)]).to.deep.equal([...nonce2.slice(0, 25)]);
        expect([...nonce]).to.not.deep.equal([...nonce2]);
    });

    it('serializeNep413Payload produces the borsh layout with the NEP-413 prefix tag', () => {
        const nonce = new Uint8Array(32).fill(7);
        const bytes = serializeNep413Payload({ message: 'hi', nonce, recipient: 'intents.near' });
        const view = new DataView(bytes.buffer);
        expect(view.getUint32(0, true)).to.equal(((1 << 31) + 413) >>> 0);
        expect(view.getUint32(4, true)).to.equal(2); // message length
        expect(bytes[8]).to.equal('h'.charCodeAt(0));
        expect(view.getUint32(42, true)).to.equal('intents.near'.length);
        expect(bytes[bytes.length - 1]).to.equal(0); // no callbackUrl
        expect(bytes.length).to.equal(4 + 4 + 2 + 32 + 4 + 'intents.near'.length + 1);
    });

    it('base58Encode matches known vectors (leading zeros become 1s)', () => {
        expect(base58Encode(new Uint8Array([0, 0, 1]))).to.equal('112');
        expect(base58Encode(new Uint8Array([0x61]))).to.equal('2g');
    });

    it('historyItemKey distinguishes items and matches duplicates across queries', () => {
        expect(historyItemKey(confidentialSwap)).to.equal(historyItemKey({ ...confidentialSwap }));
        expect(historyItemKey(shielding)).to.not.equal(historyItemKey(laterShielding));
    });
});
