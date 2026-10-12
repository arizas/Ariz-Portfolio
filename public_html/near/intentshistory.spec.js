import {
    ACCESS_TOKEN_SESSION_STORAGE_KEY,
    __setTestWallet,
    __setTestOtherAccountWallet,
    getAccountId,
} from '../arizgateway/arizgatewayaccess.js';
import {
    openConfidentialSession,
    fetchConfidentialHistory,
    buildAuthNonce,
    serializeNep413Payload,
    base58Encode,
    historyItemKey,
    ConfidentialHistoryUnavailableError,
    ConfidentialHistoryTruncatedError,
    fetchConfidentialBalances,
    __resetForTests,
} from './intentshistory.js';
import {
    mockIntentsBackend,
    signingWallet,
    otherAccountWallet,
    historyItem,
    ONECLICK_HISTORY_TEST_URL,
} from './intentshistory.mock.js';

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
        __setTestOtherAccountWallet(null);
        localStorage.removeItem(ACCESS_TOKEN_SESSION_STORAGE_KEY);
    });

    /** One click's worth: sign in as alice.near, then walk her history. */
    const fetchAsAlice = async (options) =>
        fetchConfidentialHistory(await openConfidentialSession('alice.near'), options);

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
        backend.feed = [confidentialSwap, shielding, laterShielding, unshielding];
    }

    /** A feed longer than one page, oldest `dep000` .. newest `dep<n-1>`. */
    function seedLongFeed(n) {
        backend.feed = Array.from({ length: n }, (_, i) => historyItem({
            createdAt: new Date(Date.UTC(2026, 2, 19) + i * 86400000).toISOString(),
            depositAddress: `dep${String(i).padStart(3, '0')}`,
        }));
    }

    it('fetches the whole feed with one wallet signature, oldest-first', async () => {
        seedTypicalPages();

        const items = await fetchAsAlice();

        expect(items.map((i) => i.depositAddress)).to.deep.equal(['aaa1', 'bbb2', 'ccc3', 'ddd4']);
        expect(backend.authenticateCalls).to.equal(1);
        expect(wallet.signatureCount).to.equal(1);
        // One query, one short page: the host ignores the type filters, so the
        // two-query union it used to do was two identical requests.
        expect(backend.historyRequests.length).to.equal(1);
    });

    it('pages backwards through the whole feed, not just the newest page', async () => {
        // REGRESSION (2026-09). The host pages newest-first and its cursors are
        // anchored on opposite ends of the page: `nextCursor` on the newest
        // item, `prevCursor` on the oldest. Following `nextCursor` — which this
        // code did — asks for items newer than the newest, gets an empty page,
        // and stops after one page. With 63 items of real history that returned
        // the newest 50 and the store overwrote away the other 13, leaving a
        // confidential balance that was wrong but still added up.
        seedLongFeed(63);

        const items = await fetchAsAlice();

        expect(items.length, 'the whole feed, not one page').to.equal(63);
        expect(items[0].depositAddress).to.equal('dep000');
        expect(items[62].depositAddress).to.equal('dep062');
        // 50 + 13: the short second page ends the walk.
        expect(backend.historyRequests.length).to.equal(2);
        expect(backend.historyRequests[0].query).to.not.contain('Cursor=');
        expect(backend.historyRequests[1].query).to.contain('prevCursor=');
    });

    it('refuses to return a page walk that ended on a full page', async () => {
        // If the host stops handing back a `prevCursor` while the last page was
        // still full, the client cannot have seen the end of the feed. Storing
        // that would delete history, so fail instead.
        seedLongFeed(63);
        const realFetch = window.fetch;
        window.fetch = async (url, init) => {
            const response = await realFetch(url, init);
            if (!String(url).includes('/v0/account/history')) return response;
            const body = await response.json();
            return new Response(JSON.stringify({ ...body, prevCursor: null }),
                { status: 200, headers: { 'content-type': 'application/json' } });
        };

        let caught = null;
        await fetchAsAlice({ maxPages: 5 }).catch((e) => { caught = e; });
        window.fetch = realFetch;

        expect(caught).to.be.instanceOf(ConfidentialHistoryTruncatedError);
        expect(caught.message).to.contain('stopped on a full page');
    });

    it('refuses to return a page walk whose cursor stopped advancing', async () => {
        seedLongFeed(63);
        const realFetch = window.fetch;
        window.fetch = async (url, init) => {
            // Always answer with the newest page, whatever cursor was sent.
            const stripped = String(url).replace(/&prevCursor=[^&]*/, '');
            return realFetch(stripped, init);
        };

        let caught = null;
        await fetchAsAlice({ maxPages: 5 }).catch((e) => { caught = e; });
        window.fetch = realFetch;

        expect(caught).to.be.instanceOf(ConfidentialHistoryTruncatedError);
        expect(caught.message).to.contain('stopped advancing');
    });

    it('reads history from the dedicated history host, not the (invite-gated) auth host', async () => {
        // Regression: the public 1Click host answers /v0/account/history with
        // 403 "History is invite-only for now" — history must go to the
        // separate host while the same JWT still authenticates it.
        seedTypicalPages();

        const items = await fetchAsAlice();

        expect(items.length).to.equal(4);
        // Every history request the module made hit the history host.
        expect(backend.historyRequests.length).to.equal(1);
        expect(backend.historyRequests.every((r) => r.query.startsWith('/v0/account/history')))
            .to.equal(true);
        // The mock only serves /v0/account/history under ONECLICK_HISTORY_TEST_URL;
        // that four items came back proves history was fetched from that host.
        expect(ONECLICK_HISTORY_TEST_URL).to.not.equal(backend.config.apiUrl);
        // Same bearer minted on the auth host authenticates the history host.
        expect(backend.historyRequests[0].bearer).to.equal('access-1');
    });

    it('never requests history without a session token', async () => {
        // The history host answers an unauthenticated request with 200 and a
        // global feed of other accounts' confidential deposits (an *invalid*
        // token is properly rejected with 401). So a session that somehow
        // carries no token must fail loudly rather than fetch strangers'
        // transactions into this user's ledger.
        seedTypicalPages();

        let error;
        try {
            await fetchConfidentialHistory({ config: backend.config, accountId: 'alice.near' });
        } catch (e) {
            error = e;
        }

        expect(error, 'expected a refusal, got history back').to.be.an('error');
        expect(error.message).to.contain('without a session token');
        expect(backend.historyRequests.length, 'no request may leave the client').to.equal(0);
    });

    it('rejects an auth response that carries no accessToken', async () => {
        backend.authResponse = { expiresIn: 900, refreshExpiresIn: 604800 };

        let error;
        try {
            await fetchAsAlice();
        } catch (e) {
            error = e;
        }

        expect(error, 'expected a refusal, got history back').to.be.an('error');
        expect(error.message).to.contain('no accessToken');
        expect(backend.historyRequests.length).to.equal(0);
    });

    it('signs the exact trezu-style auth payload (message shape, recipient, nonce layout)', async () => {
        seedTypicalPages();
        await fetchAsAlice();

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

        const items = await fetchAsAlice({ retryDelayMs: 1 });

        expect(items.length).to.equal(4);
        expect(backend.historyRequests.length).to.equal(3); // 2 failed + 1 successful
    });

    it('gives up after persistent server 500s', async () => {
        seedTypicalPages();
        backend.failBeforeSuccess = 100;

        let message = '';
        await fetchAsAlice({ retryDelayMs: 1 }).catch((e) => { message = e.message; });
        expect(message).to.contain('1Click history -> 500');
    });

    it('signs anew for every fetch — no 1Click session is kept', async () => {
        seedTypicalPages();

        await fetchAsAlice();
        await fetchAsAlice();

        expect(wallet.signatureCount).to.equal(2);
        expect(backend.authenticateCalls).to.equal(2);
    });

    describe('for an account other than the signed-in one', () => {
        const SESSION_KEY = 'fake-web-wallet:account-data';
        afterEach(() => localStorage.removeItem(SESSION_KEY));

        it('signs as that account and leaves the signed-in account as it was', async () => {
            seedTypicalPages();
            const bob = otherAccountWallet('bob.near');
            // The wallet's stored session for the signed-in account, which
            // signing in as bob overwrites.
            localStorage.setItem(SESSION_KEY, JSON.stringify({ accountId: 'alice.near' }));

            const items = await fetchConfidentialHistory(await openConfidentialSession('bob.near'));

            expect(items.length).to.equal(4);
            expect(bob.signatureCount).to.equal(1);
            expect(wallet.signatureCount, 'the signed-in wallet signs nothing').to.equal(0);
            expect(JSON.parse(backend.lastAuthBody.signedData.payload.message).signer_id).to.equal('bob.near');
            expect(await getAccountId()).to.equal('alice.near');
            expect(JSON.parse(localStorage.getItem(SESSION_KEY)).accountId).to.equal('alice.near');
        });

        it('leaves no wallet session behind when there was none', async () => {
            otherAccountWallet('bob.near');

            await openConfidentialSession('bob.near');

            expect(localStorage.getItem(SESSION_KEY)).to.equal(null);
            // Entries outside the wallet's own are not touched.
            expect(JSON.parse(localStorage.getItem(ACCESS_TOKEN_SESSION_STORAGE_KEY)).accountId).to.equal('alice.near');
        });

        it('refuses a signature made by a different account than the row', async () => {
            otherAccountWallet('carol.near');

            let caught = null;
            await openConfidentialSession('bob.near').catch((e) => { caught = e; });

            expect(caught?.message).to.contain('signed as carol.near, not bob.near');
            expect(backend.authenticateCalls, 'nothing sent to 1Click').to.equal(0);
            expect(localStorage.getItem(SESSION_KEY)).to.equal(null);
        });
    });

    it('reads the confidential ledger balances from the history host', async () => {
        // The only independent check that a derived balance series is complete:
        // history is *summed* into balances, so a history with a hole in it
        // still adds up, just to the wrong number.
        backend.balances = new Map([
            ['nep141:btc.omft.near', '705233'],
            ['1cs_v1:near:nep141:zec.omft.near', '4200'],
        ]);

        const balances = await fetchConfidentialBalances(await openConfidentialSession('alice.near'));

        expect(backend.balanceRequests).to.equal(1);
        expect(balances.get('nep141:btc.omft.near')).to.equal(705233n);
        // The wrapped and bare spellings of one asset must land in one bucket.
        expect(balances.get('nep141:zec.omft.near')).to.equal(4200n);
    });

    it('ignores non-confidential balances', async () => {
        const realFetch = window.fetch;
        window.fetch = async (url, init) => {
            if (!String(url).includes('/v0/account/balances')) return realFetch(url, init);
            return new Response(JSON.stringify({ balances: [
                { tokenId: 'nep141:btc.omft.near', available: '705233', source: 'private' },
                { tokenId: 'nep141:wrap.near', available: '999', source: 'public' },
            ] }), { status: 200, headers: { 'content-type': 'application/json' } });
        };

        const balances = await fetchConfidentialBalances(await openConfidentialSession('alice.near'));
        window.fetch = realFetch;

        expect([...balances.keys()]).to.deep.equal(['nep141:btc.omft.near']);
    });

    it('throws ConfidentialHistoryUnavailableError when the gateway has no API key configured', async () => {
        backend.configStatus = 404;

        let caught = null;
        await openConfidentialSession('alice.near').catch((e) => { caught = e; });
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
