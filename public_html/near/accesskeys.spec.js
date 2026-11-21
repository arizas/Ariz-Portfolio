import { mergeAccessKeys, fetchAccessKeys, searchLastUses } from './accesskeys.js';
import { arizgatewayhost, ACCESS_TOKEN_SESSION_STORAGE_KEY } from '../arizgateway/arizgatewayaccess.js';

const FULL = { type: 'FullAccess' };
// A key as the gateway reports it; nonce 117149950000039 is block 117149951, 39 signed.
const key = (publicKey, nonce, more = {}) => ({
    publicKey, nonce, permission: FULL,
    addedBlock: nonce >= 9_820_210_000_000 ? Math.floor(nonce / 1_000_000) + 1 : null,
    addedAt: null,
    transactionsSigned: nonce >= 9_820_210_000_000 ? nonce % 1_000_000 : nonce,
    lastUse: null, lastUseNotIndexed: false,
    ...more
});

describe('access keys', () => {
    describe('mergeAccessKeys', () => {
        const first = mergeAccessKeys(null, { blockHeight: 100, keys: [key('ed25519:A', 117149950000039, { addedAt: '2024-04-19T04:48:31.587Z' })] }, '2026-01-01T00:00:00.000Z');

        it('records a first check, with what the gateway says of each key', () => {
            expect(first.checkedAt).to.equal('2026-01-01T00:00:00.000Z');
            expect(first.checkedAtBlock).to.equal(100);
            expect(first.keys['ed25519:A'].observed).to.deep.equal({
                permission: FULL, nonce: 117149950000039, addedBlock: 117149951, addedAt: '2024-04-19T04:48:31.587Z',
                transactionsSigned: 39, firstSeenAt: '2026-01-01T00:00:00.000Z', lastUseWindow: null,
                lastUsed: null, lastUseNotIndexed: false, deletedBetween: null
            });
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

        it('takes the last use the gateway found', () => {
            const lastUse = { nonce: 117149950000039, txHash: 'T', at: '2026-01-02T00:00:00.000Z', relayer: 'relayer.nearmobile.near' };
            const merged = mergeAccessKeys(first, { blockHeight: 200, keys: [key('ed25519:A', 117149950000039, { lastUse })] }, '2026-02-01T00:00:00.000Z');
            expect(merged.keys['ed25519:A'].observed.lastUsed).to.deep.equal(lastUse);
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

    describe('the gateway calls', () => {
        let realFetch, responses, sent;
        beforeEach(() => {
            localStorage.setItem(ACCESS_TOKEN_SESSION_STORAGE_KEY,
                JSON.stringify({ token: 'test-token', accountId: 'a.near', issuedAt: Date.now() }));
            realFetch = window.fetch;
            sent = [];
            window.fetch = async (url, options) => {
                sent.push({ url, options });
                const next = responses.shift();
                if (next instanceof Error) {
                    throw next;
                }
                return new Response(next[1], { status: next[0] });
            };
        });
        afterEach(() => {
            window.fetch = realFetch;
            localStorage.removeItem(ACCESS_TOKEN_SESSION_STORAGE_KEY);
        });

        it('gets the keys, and posts for a last-use search, signed in', async () => {
            responses = [[200, '{"keys":[]}'], [200, '{"keys":[],"lastUseSearch":{"complete":true}}']];
            expect(await fetchAccessKeys('a.near')).to.deep.equal({ keys: [] });
            expect(await searchLastUses('a.near')).to.deep.equal({ keys: [], lastUseSearch: { complete: true } });
            expect(sent[0].url).to.equal(`${arizgatewayhost}/api/accesskeys/a.near`);
            expect(sent[0].options.method).to.equal(undefined);
            expect(sent[0].options.headers.authorization).to.equal('Bearer test-token');
            expect(sent[1].url).to.equal(`${arizgatewayhost}/api/accesskeys/a.near/lastuse`);
            expect(sent[1].options.method).to.equal('POST');
        });

        it('tries again when the gateway did not answer in time', async () => {
            responses = [new DOMException('timed out', 'TimeoutError'), [200, '{"keys":[1]}']];
            expect(await fetchAccessKeys('a.near', { pauses: [1] })).to.deep.equal({ keys: [1] });
            expect(sent.length).to.equal(2);
        });

        it('says that the lookups are paid in ARIZ on a 402', async () => {
            responses = [[402, '{"error":"authorization_required"}']];
            let error;
            try { await fetchAccessKeys('a.near', { pauses: [1] }); } catch (e) { error = e; }
            expect(error.message).to.match(/^Looking up keys through the gateway is paid in ARIZ/);
            expect(sent.length).to.equal(1);
        });
    });
});
