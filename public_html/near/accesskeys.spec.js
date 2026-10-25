import { decodeNonce, mergeAccessKeys, dateAddedKeys, signaturesOf, findLastUses, fastnear } from './accesskeys.js';
import { arizgatewayhost, ACCESS_TOKEN_SESSION_STORAGE_KEY } from '../arizgateway/arizgatewayaccess.js';

const FULL = { type: 'FullAccess' };
const key = (publicKey, nonce, permission = FULL) => ({ publicKey, nonce, permission });

describe('access keys', () => {
    describe('decodeNonce', () => {
        it('reads the block a key was added in and how many transactions it signed', () => {
            // Real keys on arizportfolio.near.
            expect(decodeNonce(117149950000039)).to.deep.equal({ addedBlock: 117149951, transactionsSigned: 39 });
            expect(decodeNonce(168955707000000)).to.deep.equal({ addedBlock: 168955708, transactionsSigned: 0 });
        });
        it('does not invent a block for a key from before start nonces', () => {
            expect(decodeNonce(0)).to.deep.equal({ addedBlock: null, transactionsSigned: 0 });
            expect(decodeNonce(412)).to.deep.equal({ addedBlock: null, transactionsSigned: 412 });
        });
    });

    describe('mergeAccessKeys', () => {
        const first = mergeAccessKeys(null, { blockHeight: 100, keys: [key('ed25519:A', 117149950000039)] }, '2026-01-01T00:00:00.000Z');

        it('records a first check', () => {
            expect(first.checkedAt).to.equal('2026-01-01T00:00:00.000Z');
            expect(first.checkedAtBlock).to.equal(100);
            const observed = first.keys['ed25519:A'].observed;
            expect(observed.firstSeenAt).to.equal('2026-01-01T00:00:00.000Z');
            expect(observed.lastUseWindow).to.equal(null);
            expect(observed.deletedBetween).to.equal(null);
        });

        it('places the last use between the two checks the nonce moved between', () => {
            const second = mergeAccessKeys(first, { blockHeight: 200, keys: [key('ed25519:A', 117149950000041)] }, '2026-02-01T00:00:00.000Z');
            expect(second.keys['ed25519:A'].observed.lastUseWindow)
                .to.deep.equal({ from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' });
            expect(second.keys['ed25519:A'].observed.firstSeenAt).to.equal('2026-01-01T00:00:00.000Z');

            // A check where nothing moved keeps the window it had.
            const third = mergeAccessKeys(second, { blockHeight: 300, keys: [key('ed25519:A', 117149950000041)] }, '2026-03-01T00:00:00.000Z');
            expect(third.keys['ed25519:A'].observed.lastUseWindow)
                .to.deep.equal({ from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' });
        });

        it('keeps a removed key and its notes, marked with when it went', () => {
            const withNote = structuredClone(first);
            withNote.keys['ed25519:A'].notes = { label: 'Old laptop' };
            const second = mergeAccessKeys(withNote, { blockHeight: 200, keys: [] }, '2026-02-01T00:00:00.000Z');
            expect(second.keys['ed25519:A'].notes).to.deep.equal({ label: 'Old laptop' });
            expect(second.keys['ed25519:A'].observed.deletedBetween)
                .to.deep.equal({ from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' });

            // Still gone at the next check: when it went does not move.
            const third = mergeAccessKeys(second, { blockHeight: 300, keys: [] }, '2026-03-01T00:00:00.000Z');
            expect(third.keys['ed25519:A'].observed.deletedBetween.to).to.equal('2026-02-01T00:00:00.000Z');
        });

        it('treats a key added again after removal as new, keeping the notes', () => {
            const withNote = structuredClone(first);
            withNote.keys['ed25519:A'].notes = { label: 'Ledger' };
            const removed = mergeAccessKeys(withNote, { blockHeight: 200, keys: [] }, '2026-02-01T00:00:00.000Z');
            const readded = mergeAccessKeys(removed, { blockHeight: 300, keys: [key('ed25519:A', 150000000000000)] }, '2026-03-01T00:00:00.000Z');
            const observed = readded.keys['ed25519:A'].observed;
            expect(observed.deletedBetween).to.equal(null);
            expect(observed.addedBlock).to.equal(150000001);
            expect(observed.firstSeenAt).to.equal('2026-03-01T00:00:00.000Z');
            expect(observed.lastUseWindow).to.equal(null);
            expect(readded.keys['ed25519:A'].notes).to.deep.equal({ label: 'Ledger' });
        });

        it('keeps a note written before the key was ever checked', () => {
            const notesOnly = { checkedAt: null, checkedAtBlock: null, keys: { 'ed25519:A': { notes: { label: 'Phone' } } } };
            const merged = mergeAccessKeys(notesOnly, { blockHeight: 100, keys: [key('ed25519:A', 117149950000039)] }, '2026-01-01T00:00:00.000Z');
            expect(merged.keys['ed25519:A'].notes).to.deep.equal({ label: 'Phone' });
            expect(merged.keys['ed25519:A'].observed.lastUseWindow).to.equal(null);
        });
    });

    describe('dateAddedKeys', () => {
        it('dates each known block once and keeps the date across checks', async () => {
            const asked = [];
            const blockTimestamp = async (height) => { asked.push(height); return '2024-04-19T04:48:31.587Z'; };
            const first = await dateAddedKeys(mergeAccessKeys(null, {
                blockHeight: 100, keys: [key('ed25519:A', 117149950000039), key('ed25519:OLD', 12)]
            }, '2026-01-01T00:00:00.000Z'), blockTimestamp);
            expect(asked).to.deep.equal([117149951]);
            expect(first.keys['ed25519:A'].observed.addedAt).to.equal('2024-04-19T04:48:31.587Z');
            expect(first.keys['ed25519:OLD'].observed.addedAt).to.equal(null);

            const second = await dateAddedKeys(mergeAccessKeys(first, {
                blockHeight: 200, keys: [key('ed25519:A', 117149950000040), key('ed25519:OLD', 12)]
            }, '2026-02-01T00:00:00.000Z'), blockTimestamp);
            expect(asked).to.deep.equal([117149951]);
            expect(second.keys['ed25519:A'].observed.addedAt).to.equal('2024-04-19T04:48:31.587Z');
        });
    });

    describe('signaturesOf', () => {
        // Shapes of two real petersalomonsen.near transactions from the archival RPC.
        it('reads the key of a transaction the account signed', () => {
            const transaction = {
                signer_id: 'petersalomonsen.near', public_key: 'ed25519:2FFL', nonce: 1,
                actions: [{ Transfer: { deposit: '1' } }]
            };
            expect(signaturesOf(transaction, 'petersalomonsen.near'))
                .to.deep.equal([{ publicKey: 'ed25519:2FFL', nonce: 1, relayer: null }]);
        });
        it('reads the key of a delegate action a relayer submitted', () => {
            const transaction = {
                signer_id: 'relayer.nearmobile.near', public_key: 'ed25519:2DT4', nonce: 199287356006015,
                actions: [{ Delegate: { delegate_action: { sender_id: 'petersalomonsen.near', public_key: 'ed25519:2FFL', nonce: 1267 } } }]
            };
            expect(signaturesOf(transaction, 'petersalomonsen.near'))
                .to.deep.equal([{ publicKey: 'ed25519:2FFL', nonce: 1267, relayer: 'relayer.nearmobile.near' }]);
            expect(signaturesOf(transaction, 'someoneelse.near')).to.deep.equal([]);
        });
    });

    describe('findLastUses', () => {
        const at = (iso) => (BigInt(Date.parse(iso)) * 1_000_000n).toString();
        const signed = (hash, iso, publicKey, nonce, relayer = null) => ({
            listed: { transaction_hash: hash, tx_block_timestamp: at(iso) },
            transaction: relayer
                ? { hash, signer_id: relayer, public_key: 'ed25519:R', nonce: 1, actions: [{ Delegate: { delegate_action: { sender_id: 'a.near', public_key: publicKey, nonce } } }] }
                : { hash, signer_id: 'a.near', public_key: publicKey, nonce, actions: [] }
        });
        // Two pages of the signed-transaction index, newest first.
        const index = [
            [signed('T4', '2026-04-01T00:00:00.000Z', 'ed25519:A', 117149950000041, 'relayer.nearmobile.near'),
                signed('T3', '2026-03-01T00:00:00.000Z', 'ed25519:B', 7)],
            [signed('T2', '2026-02-01T00:00:00.000Z', 'ed25519:A', 117149950000040),
                signed('T1', '2026-01-01T00:00:00.000Z', 'ed25519:C', 3)]
        ];
        const fakeIndex = () => {
            const calls = [];
            const call = async (path, body) => {
                calls.push({ path, body });
                const all = index.flat();
                if (path === '/tx/v0/account') {
                    const page = body.resume_token ? Number(body.resume_token) : 0;
                    return { account_txs: index[page].map(t => t.listed), resume_token: page + 1 < index.length ? String(page + 1) : null };
                }
                return { transactions: body.tx_hashes.map(hash => ({ transaction: all.find(t => t.listed.transaction_hash === hash).transaction })) };
            };
            return { calls, call };
        };
        const accessKeysWith = (keys) => mergeAccessKeys(null, { blockHeight: 1, keys }, '2026-05-01T00:00:00.000Z');

        it('takes the newest signature of each key, and stops once all are found', async () => {
            const accessKeys = accessKeysWith([key('ed25519:A', 117149950000041), key('ed25519:B', 7), key('ed25519:UNUSED', 168955707000000)]);
            const { calls, call } = fakeIndex();
            expect(await findLastUses({ accessKeys, accountId: 'a.near', call })).to.deep.equal({ pages: 1, complete: true });
            expect(calls.map(c => c.path)).to.deep.equal(['/tx/v0/account', '/tx/v0/transactions']);
            expect(calls[0].body).to.deep.equal({ account_id: 'a.near', is_any_signer: true, limit: 200 });
            expect(accessKeys.keys['ed25519:A'].observed.lastUsed).to.deep.equal({
                txHash: 'T4', at: '2026-04-01T00:00:00.000Z', nonce: 117149950000041, relayer: 'relayer.nearmobile.near'
            });
            expect(accessKeys.keys['ed25519:B'].observed.lastUsed.txHash).to.equal('T3');
            expect(accessKeys.keys['ed25519:UNUSED'].observed.lastUsed).to.equal(null);

            // Nothing has signed since: nothing is looked up.
            const again = fakeIndex();
            expect(await findLastUses({ accessKeys, accountId: 'a.near', call: again.call })).to.deep.equal({ pages: 0, complete: true });
            expect(again.calls).to.deep.equal([]);
        });

        it('follows the resume token, and remembers a key the index does not have', async () => {
            const accessKeys = accessKeysWith([key('ed25519:C', 3), key('ed25519:OLD', 12)]);
            const { calls, call } = fakeIndex();
            expect(await findLastUses({ accessKeys, accountId: 'a.near', call })).to.deep.equal({ pages: 2, complete: true });
            expect(calls[2].body.resume_token).to.equal('1');
            expect(accessKeys.keys['ed25519:C'].observed.lastUsed.txHash).to.equal('T1');
            expect(accessKeys.keys['ed25519:OLD'].observed.lastUseNotIndexed).to.equal(12);

            // Not looked for again until its nonce moves.
            const again = fakeIndex();
            await findLastUses({ accessKeys, accountId: 'a.near', call: again.call });
            expect(again.calls).to.deep.equal([]);
        });

        it('takes an answer without the list as an error, not as the end of the index', async () => {
            const accessKeys = accessKeysWith([key('ed25519:C', 3)]);
            const { call } = fakeIndex();
            const failingSecondPage = async (path, body) => body.resume_token ? { message: 'rate limited' } : call(path, body);
            let error;
            try {
                await findLastUses({ accessKeys, accountId: 'a.near', call: failingSecondPage });
            } catch (e) {
                error = e;
            }
            expect(error.message).to.match(/did not answer with a list/);
            expect(accessKeys.keys['ed25519:C'].observed.lastUseNotIndexed).to.equal(undefined);
        });

        it('stops at the page limit, saying it is not done', async () => {
            const accessKeys = accessKeysWith([key('ed25519:C', 3)]);
            const { call } = fakeIndex();
            expect(await findLastUses({ accessKeys, accountId: 'a.near', call, maxPages: 1 })).to.deep.equal({ pages: 1, complete: false });
            expect(accessKeys.keys['ed25519:C'].observed.lastUsed).to.equal(null);
            expect(accessKeys.keys['ed25519:C'].observed.lastUseNotIndexed).to.equal(undefined);
        });

        it('does not credit a key added again with a signature from before', async () => {
            // A was removed and added again in block 150000001: T4 and T2 were the earlier A.
            const accessKeys = accessKeysWith([key('ed25519:A', 150000000000001)]);
            await findLastUses({ accessKeys, accountId: 'a.near', call: fakeIndex().call });
            expect(accessKeys.keys['ed25519:A'].observed.lastUsed).to.equal(null);
        });

        it('keeps the last use across a check where the key did not change', () => {
            const accessKeys = accessKeysWith([key('ed25519:A', 117149950000041)]);
            accessKeys.keys['ed25519:A'].observed.lastUsed = { txHash: 'T4', at: '2026-04-01T00:00:00.000Z', nonce: 117149950000041, relayer: null };
            const next = mergeAccessKeys(accessKeys, { blockHeight: 2, keys: [key('ed25519:A', 117149950000041)] }, '2026-06-01T00:00:00.000Z');
            expect(next.keys['ed25519:A'].observed.lastUsed.txHash).to.equal('T4');
        });
    });

    describe('fastnear (through the gateway)', () => {
        let realFetch, responses, sent;
        beforeEach(() => {
            localStorage.setItem(ACCESS_TOKEN_SESSION_STORAGE_KEY,
                JSON.stringify({ token: 'test-token', accountId: 'a.near', issuedAt: Date.now() }));
            realFetch = window.fetch;
            sent = [];
            window.fetch = async (url, options) => {
                sent.push({ url, options });
                const [status, body] = responses.shift();
                return new Response(body, { status });
            };
        });
        afterEach(() => {
            window.fetch = realFetch;
            localStorage.removeItem(ACCESS_TOKEN_SESSION_STORAGE_KEY);
        });

        it('posts to /api/fastnear with the token, and tries again after a 429', async () => {
            responses = [[429, 'too many'], [200, '{"result":1}']];
            expect(await fastnear('/rpc', { method: 'block' }, [1])).to.deep.equal({ result: 1 });
            expect(sent.length).to.equal(2);
            expect(sent[0].url).to.equal(`${arizgatewayhost}/api/fastnear/rpc`);
            expect(sent[0].options.method).to.equal('POST');
            expect(sent[0].options.body).to.equal('{"method":"block"}');
            expect(sent[0].options.headers.authorization).to.equal('Bearer test-token');
        });

        it('tries again when FastNear did not answer in time', async () => {
            responses = [[504, '{"error":"upstream_timeout"}'], [200, '{"result":2}']];
            expect(await fastnear('/tx/v0/transactions', { tx_hashes: ['A'] }, [1])).to.deep.equal({ result: 2 });
            expect(sent.length).to.equal(2);
        });

        it('says that the lookups are paid in ARIZ on a 402', async () => {
            responses = [[402, '{"error":"authorization_required"}']];
            let error;
            try { await fastnear('/rpc', {}, [1]); } catch (e) { error = e; }
            expect(error.message).to.match(/^Looking up keys through the gateway is paid in ARIZ/);
            expect(sent.length).to.equal(1);
        });
    });
});
