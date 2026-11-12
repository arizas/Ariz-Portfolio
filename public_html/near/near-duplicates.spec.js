import { applyNearCopyChoices, findNearCopies, gatewayNearBalances, nearCopyKey, resolveNearCopies } from './near-duplicates.js';

// petersalomonsen.near, 2026-10-22: one intents withdrawal, stored at block
// 221111269 where the balance moved, and again at 221111265.
const Y = (near) => (BigInt(Math.round(near * 1e4)) * 10n ** 20n).toString();
function row(block, before, after, over = {}) {
    return {
        block_height: block, block_timestamp: '2026-10-22T15:38:51.263Z', tx_hash: null, tx_block: null,
        signer_id: null, receiver_id: null, predecessor_id: null, receipt_id: null, counterparty: null, token_id: 'near',
        amount: (BigInt(Y(after)) - BigInt(Y(before))).toString(), balance_before: Y(before), balance_after: Y(after), ...over,
    };
}
const withdrawal = { tx_hash: 'DTJZ3FQK', receipt_id: 'HrwfSfUV', counterparty: 'intents.near', predecessor_id: 'intents.near' };

/** The chain as the balance reader sees it, counting the blocks asked for. */
function chain(balanceAt) {
    const asked = [];
    return {
        asked,
        read: async (blocks) => { asked.push(...blocks); return new Map(blocks.map((b) => [b, Y(balanceAt(b))])); },
    };
}
const movedAt269 = (b) => (b >= 221111269 ? 37.8921 : 35.6028);

describe('NEAR rows stored twice', function () {
    it('finds a movement stored twice, and not a repeat far away or two rows in one block', () => {
        const records = [
            row(221111269, 35.6028, 37.8921, withdrawal),
            row(221111265, 35.6028, 37.8921, withdrawal),
            row(221112269, 35.6028, 37.8921), // the same amount and balances 1000 blocks later
            row(221000000, 10, 11), row(221000000, 10, 11), // two transfers settling in one block
        ];
        const groups = findNearCopies(records);
        expect(groups.length).to.equal(1);
        expect(groups[0].map((r) => r.block_height)).to.deep.equal([221111265, 221111269]);
        expect(nearCopyKey(groups[0])).to.equal(`receipt:HrwfSfUV:${records[0].amount}`);
    });

    it('keeps the copy where the chain shows the movement, with the details the other had', async () => {
        const { read } = chain(movedAt269);
        const records = [row(221111269, 35.6028, 37.8921, { counterparty: 'unknown' }), row(221111265, 35.6028, 37.8921, withdrawal), row(221000000, 30, 35.6028)];
        const { records: kept, removed, unresolved } = await resolveNearCopies(records, read);
        expect(kept.map((r) => r.block_height)).to.deep.equal([221111269, 221000000]);
        expect(removed.length).to.equal(1);
        expect(unresolved).to.deep.equal([]);
        expect(kept[0].tx_hash).to.equal('DTJZ3FQK');
        expect(kept[0].counterparty).to.equal('intents.near');
    });

    it('removes nothing the chain does not settle, and says which', async () => {
        const { read } = chain(() => 35.6028);
        const records = [row(221111269, 35.6028, 37.8921, withdrawal), row(221111265, 35.6028, 37.8921, withdrawal)];
        const result = await resolveNearCopies(records, read);
        expect(result.records).to.equal(records);
        expect(result.unresolved.length).to.equal(1);
    });

    it('keeps both when the chain shows both', async () => {
        const { read } = chain((b) => (b >= 304 ? 11 : b >= 302 ? 10 : b >= 300 ? 11 : 10));
        const records = [row(304, 10, 11), row(302, 11, 10), row(300, 10, 11)];
        const result = await resolveNearCopies(records, read);
        expect(result.records.length).to.equal(3);
        expect(result.unresolved).to.deep.equal([]);
    });

    it('asks the chain nothing when there are no copies', async () => {
        const { read, asked } = chain(movedAt269);
        await resolveNearCopies([row(221111269, 35.6028, 37.8921), row(221000000, 30, 35.6028)], read);
        expect(asked).to.deep.equal([]);
    });

    it('applies the owner\'s choice, and skips that group in the chain check', async () => {
        const records = [row(221111269, 35.6028, 37.8921, withdrawal), row(221111265, 35.6028, 37.8921, withdrawal)];
        const key = nearCopyKey(findNearCopies(records)[0]);
        const chosen = applyNearCopyChoices(records, { [key]: { keep: 221111265 } });
        expect(chosen.records.map((r) => r.block_height)).to.deep.equal([221111265]);
        expect(chosen.decided.has(key)).to.be.true;

        const all = applyNearCopyChoices(records, { [key]: { keep: 'all' } });
        expect(all.records.length).to.equal(2);
        const { asked, read } = chain(() => 35.6028);
        const after = await resolveNearCopies(all.records, read, { skip: all.decided });
        expect(after.unresolved).to.deep.equal([]);
        expect(asked).to.deep.equal([]);
    });

    it('ignores a choice for a block that is no longer among the copies', () => {
        const records = [row(221111269, 35.6028, 37.8921, withdrawal), row(221111265, 35.6028, 37.8921, withdrawal)];
        const key = nearCopyKey(findNearCopies(records)[0]);
        const result = applyNearCopyChoices(records, { [key]: { keep: 1 } });
        expect(result.records).to.equal(records);
        expect(result.decided.size).to.equal(0);
    });

    it('reads the balances through the gateway, two per copy, and leaves out what it could not read', async () => {
        const requests = [];
        const gateway = {
            readBalances: async (account, reads) => {
                requests.push({ account, reads });
                return { balances: reads.map(({ block }) => (block === 221111264 ? { block, error: 'missing' } : { block, balance: Y(movedAt269(block)) })) };
            },
        };
        const read = gatewayNearBalances(gateway, 'petersalomonsen.near');
        const balances = await read([221111264, 221111265, 221111268, 221111269]);
        expect(requests[0].reads[0]).to.deep.equal({ kind: 'near', token: 'near', block: 221111264 });
        expect(balances.has(221111264)).to.be.false;
        expect(balances.get(221111269)).to.equal(Y(37.8921));
    });
});

describe('NEAR rows stored twice, when an account is fetched', function () {
    // Imported here so the pure tests above need no store.
    let store;
    before(async () => { store = await import('../storage/domainobjectstore.js'); });
    const fetched = () => ({
        version: 2, accountId: 'copies.near', metadata: { totalRecords: 3 },
        records: [row(221111269, 35.6028, 37.8921, withdrawal), row(221111265, 35.6028, 37.8921, withdrawal), row(221000000, 30, 35.6028)],
    });

    it('keeps the copy the chain confirms, and says how many it removed', async () => {
        const { read } = chain(movedAt269);
        const { rawData, nearCopies } = await store.withoutNearCopies('copies.near', fetched(), read);
        expect(rawData.records.map((r) => r.block_height)).to.deep.equal([221111269, 221000000]);
        expect(rawData.metadata.totalRecords).to.equal(2);
        expect(nearCopies).to.deep.equal({ removed: 1, undecided: 0 });
    });

    it('applies the owner\'s earlier choice before asking the chain anything', async () => {
        const data = fetched();
        await store.setNearCopyChoice('copies.near', nearCopyKey(findNearCopies(data.records)[0]), 221111265);
        const { read, asked } = chain(movedAt269);
        const { rawData, nearCopies } = await store.withoutNearCopies('copies.near', data, read);
        expect(rawData.records.map((r) => r.block_height)).to.deep.equal([221111265, 221000000]);
        expect(nearCopies).to.deep.equal({ removed: 1, undecided: 0 });
        expect(asked).to.deep.equal([]);
    });

    it('stores the records as fetched when the chain cannot be read, and counts what waits', async () => {
        const data = { ...fetched(), accountId: 'unread.near' };
        const failing = async () => { throw new Error('offline'); };
        const { rawData, nearCopies } = await store.withoutNearCopies('unread.near', data, failing);
        expect(rawData).to.equal(data);
        expect(nearCopies).to.deep.equal({ removed: 0, undecided: 1 });
    });
});
