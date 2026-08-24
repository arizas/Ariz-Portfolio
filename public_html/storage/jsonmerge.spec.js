import { mergeJsonText, repairConflictedText, splitConflictSides, hasConflictMarkers, UnmergeableError } from './jsonmerge.js';

// A conflicted file as libgit2 writes it, built from lines so the markers here
// are never mistaken for real ones by an editor or by git itself.
const conflicted = (shared, ours, theirs) => [
    ...shared,
    '<'.repeat(7) + ' HEAD',
    ...ours,
    '='.repeat(7),
    ...theirs,
    '>'.repeat(7) + ' master',
].join('\n');

describe('jsonmerge', () => {
    describe('price histories', () => {
        const path = 'pricehistory/NEAR/nok.json';

        it('unions two days that were fetched on different devices', () => {
            const merged = mergeJsonText(path,
                '{\n "2026-08-21": 16.4,\n "2026-08-22": 18.3\n}',
                '{\n "2026-08-21": 16.4,\n "2026-08-23": 17.8\n}');
            expect(JSON.parse(merged)).to.deep.equal({ '2026-08-21': 16.4, '2026-08-22': 18.3, '2026-08-23': 17.8 });
        });

        it('keeps the file in date order whichever side had the day first', () => {
            const merged = mergeJsonText(path, '{\n "2026-08-23": 3\n}', '{\n "2026-08-21": 1,\n "2026-08-22": 2\n}');
            expect(Object.keys(JSON.parse(merged))).to.deep.equal(['2026-08-21', '2026-08-22', '2026-08-23']);
        });

        it('resolves the same day priced twice the same way on every device', () => {
            // Deterministic, not "best": both devices must land on one answer or
            // the stores never converge.
            expect(mergeJsonText(path, '{\n "2026-08-21": 1\n}', '{\n "2026-08-21": 2\n}'))
                .to.equal(mergeJsonText(path, '{\n "2026-08-21": 1\n}', '{\n "2026-08-21": 2\n}'));
            expect(JSON.parse(mergeJsonText(path, '{\n "2026-08-21": 1\n}', '{\n "2026-08-21": 2\n}'))['2026-08-21']).to.equal(2);
        });

        it('keeps the one-space indentation the store is written with', () => {
            expect(mergeJsonText(path, '{\n "2026-08-21": 1\n}', '{\n "2026-08-22": 2\n}'))
                .to.equal('{\n "2026-08-21": 1,\n "2026-08-22": 2\n}');
        });

        it('keeps a compactly written file compact', () => {
            expect(mergeJsonText('depositaccounts.json', '{"a":1}', '{"b":2}')).to.equal('{"a":1,"b":2}');
        });
    });

    describe('transactions', () => {
        it('never duplicates a transaction both devices already had', () => {
            const merged = JSON.parse(mergeJsonText('accountdata/x.near/transactions.json',
                '[\n {"hash":"a","block_height":2},\n {"hash":"b","block_height":1}\n]',
                '[\n {"hash":"c","block_height":3},\n {"hash":"b","block_height":1}\n]'));
            expect(merged.map((tx) => tx.hash)).to.deep.equal(['c', 'a', 'b']); // block height descending
        });

        it('treats one hash moving two tokens as two fungible token transactions', () => {
            const row = (contract) => `{"transaction_hash":"h","block_height":1,"ft":{"contract_id":"${contract}"}}`;
            const merged = JSON.parse(mergeJsonText('accountdata/x.near/fungible_token_transactions.json',
                `[\n ${row('usdt.near')}\n]`, `[\n ${row('usdc.near')}\n]`));
            expect(merged.map((tx) => tx.ft.contract_id)).to.have.members(['usdt.near', 'usdc.near']);
        });

        it('keeps a staking reward and a principal move made at the same height', () => {
            const merged = JSON.parse(mergeJsonText('accountdata/x.near/stakingpools/astro-stakers.poolv1.near.json',
                '[\n {"block_height":10,"balance":5}\n]',
                '[\n {"block_height":10,"balance":5,"hash":"H"}\n]'));
            expect(merged).to.have.lengthOf(2);
        });
    });

    describe('accounting records', () => {
        const withRecords = (records, updatedAt) => JSON.stringify({
            version: 2, updatedAt, records, stakingPools: [], metadata: { firstBlock: 0, lastBlock: 0, totalRecords: 0 },
        }, null, 1);
        const record = (height) => ({ block_height: height, token_id: 'near', receipt_id: null, tx_hash: null, amount: '0', balance_after: '5' });

        it('unions the records and re-describes the merged file', () => {
            const merged = JSON.parse(mergeJsonText('accountdata/x.near/records.json',
                withRecords([record(1), record(2)], '2026-08-22T03:00:00.000Z'),
                withRecords([record(2), record(3)], '2026-08-24T03:00:00.000Z')));
            expect(merged.records.map((r) => r.block_height)).to.deep.equal([1, 2, 3]);
            expect(merged.metadata).to.deep.include({ firstBlock: 1, lastBlock: 3, totalRecords: 3 });
            expect(merged.updatedAt).to.equal('2026-08-24T03:00:00.000Z'); // the later fetch describes both
        });
    });

    describe('a file only one device has', () => {
        it('takes the side that has it', () => {
            expect(JSON.parse(mergeJsonText('accounts.json', null, '["a.near"]'))).to.deep.equal(['a.near']);
            expect(JSON.parse(mergeJsonText('accounts.json', '["a.near"]', null))).to.deep.equal(['a.near']);
        });
    });

    describe('files already committed with conflict markers', () => {
        const damaged = conflicted(
            ['{', ' "2026-08-20": 1,'],
            [' "2026-08-21": 2,', ' "2026-08-22": 3'],
            [' "2026-08-21": 2'],
        ) + '\n}';

        it('recognises them', () => {
            expect(hasConflictMarkers(damaged)).to.equal(true);
            expect(hasConflictMarkers('{"a":1}')).to.equal(false);
        });

        it('recovers both whole documents from the markers', () => {
            const { ours, theirs } = splitConflictSides(damaged);
            expect(JSON.parse(ours)).to.deep.equal({ '2026-08-20': 1, '2026-08-21': 2, '2026-08-22': 3 });
            expect(JSON.parse(theirs)).to.deep.equal({ '2026-08-20': 1, '2026-08-21': 2 });
        });

        it('repairs the file from itself, keeping every day', () => {
            expect(JSON.parse(repairConflictedText('pricehistory/NEAR/nok.json', damaged)))
                .to.deep.equal({ '2026-08-20': 1, '2026-08-21': 2, '2026-08-22': 3 });
        });

        it('leaves an undamaged file untouched', () => {
            expect(repairConflictedText('pricehistory/NEAR/nok.json', '{\n "a": 1\n}')).to.equal('{\n "a": 1\n}');
        });

        it('merges a damaged side against a healthy one, so a device that pulled the damage still heals', () => {
            const merged = mergeJsonText('pricehistory/NEAR/nok.json', damaged, '{\n "2026-08-23": 4\n}');
            expect(JSON.parse(merged)).to.deep.equal({ '2026-08-20': 1, '2026-08-21': 2, '2026-08-22': 3, '2026-08-23': 4 });
        });
    });

    describe('what it refuses to guess at', () => {
        it('reports a side that is not JSON instead of inventing a merge', () => {
            let error;
            try { mergeJsonText('accounts.json', 'not json at all', '["a"]'); } catch (e) { error = e; }
            expect(error).to.be.instanceOf(UnmergeableError);
            expect(error.message).to.contain('accounts.json');
        });
    });
});
