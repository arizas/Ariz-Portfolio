import { decodeNonce, mergeAccessKeys, dateAddedKeys, signaturesOf, findLastUses } from './accesskeys.js';

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
        const transactions = [
            { hash: 'T3', block_timestamp: at('2026-03-01T00:00:00.000Z') },
            { hash: 'T2', block_timestamp: at('2026-02-01T00:00:00.000Z') },
            { hash: 'T1', block_timestamp: at('2026-01-01T00:00:00.000Z') }
        ];
        const chain = {
            T3: [{ publicKey: 'ed25519:A', nonce: 117149950000041, relayer: 'relayer.nearmobile.near' }],
            T2: [{ publicKey: 'ed25519:B', nonce: 5, relayer: null }],
            T1: [{ publicKey: 'ed25519:A', nonce: 117149950000040, relayer: null }]
        };
        const accessKeysWith = (keys) => mergeAccessKeys(null, { blockHeight: 1, keys }, '2026-04-01T00:00:00.000Z');

        it('takes the newest signature of each key and stops when all are found', async () => {
            const accessKeys = accessKeysWith([key('ed25519:A', 117149950000041), key('ed25519:B', 7), key('ed25519:NEW', 168955707000000)]);
            const asked = [];
            const signatureCache = {};
            const result = await findLastUses({
                accessKeys, transactions, accountId: 'a.near', signatureCache,
                lookup: async (hash) => { asked.push(hash); return chain[hash]; }
            });
            expect(asked).to.deep.equal(['T3', 'T2']);
            expect(result).to.deep.equal({ looked: 2, unchecked: 0 });
            expect(accessKeys.keys['ed25519:A'].observed.lastUsed).to.deep.equal({
                txHash: 'T3', at: '2026-03-01T00:00:00.000Z', nonce: 117149950000041, relayer: 'relayer.nearmobile.near'
            });
            // B has signed twice since: its newest signature is not in the history.
            expect(accessKeys.keys['ed25519:B'].observed.lastUsed.nonce).to.equal(5);
            expect(accessKeys.keys['ed25519:NEW'].observed.lastUsed).to.equal(null);

            // A second run looks nothing up again.
            asked.length = 0;
            await findLastUses({ accessKeys, transactions, accountId: 'a.near', signatureCache, lookup: async (hash) => { asked.push(hash); return chain[hash]; } });
            expect(asked).to.deep.equal([]);
            expect(accessKeys.keys['ed25519:A'].observed.lastUsed.txHash).to.equal('T3');
        });

        it('stops at the lookup budget and says how much is left', async () => {
            const accessKeys = accessKeysWith([key('ed25519:C', 3)]);
            const result = await findLastUses({
                accessKeys, transactions, accountId: 'a.near', signatureCache: {}, maxLookups: 2,
                lookup: async (hash) => chain[hash]
            });
            expect(result).to.deep.equal({ looked: 2, unchecked: 1 });
            expect(accessKeys.keys['ed25519:C'].observed.lastUsed).to.equal(null);
        });

        it('does not credit a key added again with a signature from before', async () => {
            // A was removed and added again in block 150000001: T1-T3 were signed by the earlier A.
            const accessKeys = accessKeysWith([key('ed25519:A', 150000000000001)]);
            await findLastUses({ accessKeys, transactions, accountId: 'a.near', signatureCache: {}, lookup: async (hash) => chain[hash] });
            expect(accessKeys.keys['ed25519:A'].observed.lastUsed).to.equal(null);
        });

        it('keeps the last use across a check where the key did not change', () => {
            const accessKeys = accessKeysWith([key('ed25519:A', 117149950000041)]);
            accessKeys.keys['ed25519:A'].observed.lastUsed = { txHash: 'T3', at: '2026-03-01T00:00:00.000Z', nonce: 117149950000041, relayer: null };
            const next = mergeAccessKeys(accessKeys, { blockHeight: 2, keys: [key('ed25519:A', 117149950000041)] }, '2026-05-01T00:00:00.000Z');
            expect(next.keys['ed25519:A'].observed.lastUsed.txHash).to.equal('T3');
        });
    });
});
