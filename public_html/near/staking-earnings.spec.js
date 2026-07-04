import { recomputeStakingEarnings } from './accounting-export.js';

const N = (near) => near * 1e24; // NEAR -> raw yocto

// A pool balance changes only two ways: principal moves (a transaction -> the entry
// has a `hash`) or reward accrual (a plain snapshot, no `hash`). recomputeStakingEarnings
// must book the former as deposit/withdrawal (earnings 0) and only the latter as reward.
describe('recomputeStakingEarnings', () => {
    const sum = (entries, k) => entries.reduce((t, e) => t + e[k], 0);

    it('books deposits as principal, not reward (the npro bug)', () => {
        // Every balance jump is a deposit (has a hash) -> zero real reward.
        const entries = [
            { block_height: 1, balance: N(150), hash: 'a' },
            { block_height: 2, balance: N(5350), hash: 'b' },   // +5200 deposit
            { block_height: 3, balance: N(11988), hash: 'c' },  // +6638 deposit
        ];
        const out = recomputeStakingEarnings(entries);
        expect(sum(out, 'earnings')).to.equal(0);
        expect(sum(out, 'deposit')).to.equal(N(11988));
    });

    it('books balance creep on snapshots (no hash) as reward', () => {
        const entries = [
            { block_height: 1, balance: N(1000), hash: 'dep' }, // opening deposit
            { block_height: 2, balance: N(1002) },              // +2 reward (snapshot)
            { block_height: 3, balance: N(1005) },              // +3 reward (snapshot)
        ];
        const out = recomputeStakingEarnings(entries);
        expect(sum(out, 'earnings')).to.be.closeTo(N(5), 1e15);
    });

    it('satisfies earnings = finalBalance + withdrawals - deposits', () => {
        const entries = [
            { block_height: 1, balance: N(1000), hash: 'dep1' }, // deposit 1000
            { block_height: 2, balance: N(1010) },               // +10 reward
            { block_height: 3, balance: N(510), hash: 'wd1' },   // withdraw 500
            { block_height: 4, balance: N(515) },                // +5 reward
        ];
        const out = recomputeStakingEarnings(entries);
        const final = N(515), deposits = sum(out, 'deposit'), withdrawals = sum(out, 'withdrawal');
        expect(sum(out, 'earnings')).to.be.closeTo(final + withdrawals - deposits, 1e15);
        expect(sum(out, 'earnings')).to.be.closeTo(N(15), 1e15);
    });

    it('treats a mid-history opening balance as baseline, not reward', () => {
        // First entry is a snapshot with an existing balance -> must not be booked as reward.
        const entries = [
            { block_height: 1, balance: N(5000) },   // opening snapshot, no hash
            { block_height: 2, balance: N(5003) },   // +3 reward
        ];
        const out = recomputeStakingEarnings(entries);
        expect(sum(out, 'earnings')).to.be.closeTo(N(3), 1e15);
    });

    it('ignores a spurious balance=0 blip between real balances (re-stake)', () => {
        // 10000 -> 0 (blip, has hash) -> 11988 (has hash): no reward, just principal.
        const entries = [
            { block_height: 1, balance: N(10000), hash: 'x' },
            { block_height: 2, balance: N(0), hash: 'y' },
            { block_height: 3, balance: N(11988), hash: 'z' },
        ];
        const out = recomputeStakingEarnings(entries);
        expect(sum(out, 'earnings')).to.equal(0);
    });

    it('returns entries block-height descending', () => {
        const out = recomputeStakingEarnings([
            { block_height: 1, balance: N(1), hash: 'a' },
            { block_height: 3, balance: N(3), hash: 'c' },
            { block_height: 2, balance: N(2), hash: 'b' },
        ]);
        expect(out.map(e => e.block_height)).to.deep.equal([3, 2, 1]);
    });
});
