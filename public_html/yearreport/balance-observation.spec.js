import { deriveChangedBalances, isBalanceObservation } from './yearreportdata.js';

// The accounting export writes the same movement twice: once as the real
// transaction, once as a `block-<height>` balance observation. Both rows carry
// the same balance, so a difference taken between consecutive rows lands on
// whichever comes first — the observation — leaving the real transaction at
// zero. On a real store that misdated withdrawals by up to two days and
// conjured a run of movements out of observations that reversed themselves.
describe('telling an observation from a movement', () => {
    it('recognises the synthetic hash', () => {
        expect(isBalanceObservation({ transaction_hash: 'block-189976766' })).to.equal(true);
        expect(isBalanceObservation({ transaction_hash: 'G9YYdkxWbbJMy7FcSNjo3HRicVBgot2ici4mAXyhMYwu' })).to.equal(false);
    });

    it('survives a row with no hash', () => {
        expect(isBalanceObservation({})).to.equal(false);
        expect(isBalanceObservation(undefined)).to.equal(false);
        expect(isBalanceObservation({ transaction_hash: 42 })).to.equal(false);
    });
});

// Rows arrive newest first, each carrying the balance that followed it.
const row = (hash, balance) => ({ transaction_hash: hash, balance: String(balance) });
const changes = (rows) => deriveChangedBalances(rows).map(r => Number(r.changedBalance));

describe('what each transaction moved', () => {
    it('is the step down to the previous transaction', () => {
        expect(changes([row('c', 30), row('b', 20), row('a', 5)])).to.deep.equal([10, 15, 5]);
    });

    // The shape of a real case: one withdrawal written twice.
    // Both rows carry balance 0, so the difference used to land on the earlier
    // one — the observation — and the transaction that actually happened, at
    // 11:23:58 and confirmed by the receiving exchange, was left at zero.
    it('puts the change on the transaction, not the observation beside it', () => {
        const rows = [
            row('6Q9k52UMwCnnfCf8SywoUWDc', 0),
            row('block-184936698', 0),
            row('HCwKKtCWzzXdSzsicfmDSW9q', 5913439411),
        ];
        expect(changes(rows)).to.deep.equal([-5913439411, 0, 5913439411]);
    });

    // Two observations a second apart, out and straight back. No transaction
    // explains either, and they were being read as a thousand dollars leaving.
    it('reads nothing out of an observation that reverses itself', () => {
        const rows = [
            row('2a2ppFSjdnEFQGkWjxQkDTt4', 1022607513),
            row('block-187819210', 1022607513),
            row('block-187819209', 0),
            row('older', 1023827513),
        ];
        expect(changes(rows)).to.deep.equal([-1220000, 0, 0, 1023827513]);
    });

    // The same holding reported as gone on three different days.
    it('reads nothing out of an observation repeated across days', () => {
        const rows = [
            row('block-183400936', 0), row('block-183227742', 0), row('block-182821949', 0),
            row('real', 119000000),
        ];
        expect(changes(rows)).to.deep.equal([0, 0, 0, 119000000]);
    });

    // A movement split across an observation used to arrive as two legs.
    it('keeps a single movement in one piece', () => {
        const rows = [
            row('3t6dFukUvBoPAZKMy9Ci6bbB', 0),
            row('block-188882638', 1257597355),
            row('4LZMaBXCyTkBZ8kccLawXEgw', 2865165322),
        ];
        expect(changes(rows)).to.deep.equal([-2865165322, 0, 2865165322]);
    });

    it('handles a list that is only observations', () => {
        expect(changes([row('block-1', 5), row('block-2', 5)])).to.deep.equal([0, 0]);
    });

    it('handles an empty list', () => {
        expect(changes([])).to.deep.equal([]);
    });
});
