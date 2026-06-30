import { nearLiquidStakedRaw } from './portfolio-data.js';

// Daily balances as produced by calculateYearReportData: chronological yyyy-MM-dd
// keys, each with accountBalance (raw yocto BigInt, on-chain liquid) and
// stakingBalance (raw yocto number, staked).
function dailyBalances() {
    return {
        '2025-01-01': { accountBalance: 100n * 10n ** 24n, stakingBalance: 0 },
        // staked a chunk: liquid drops, staked rises (FIFO can't see this move)
        '2025-06-01': { accountBalance: 10n * 10n ** 24n, stakingBalance: 90 * 1e24 },
        '2025-12-31': { accountBalance: 4n * 10n ** 24n, stakingBalance: 96 * 1e24 },
    };
}

describe('nearLiquidStakedRaw', () => {
    it('reads the latest day when no date is given', () => {
        const { liquidRaw, stakedRaw, totalRaw } = nearLiquidStakedRaw(dailyBalances());
        expect(liquidRaw).to.equal(4e24);
        expect(stakedRaw).to.equal(96e24);
        expect(totalRaw).to.equal(100e24);
    });

    it('reads the last day strictly before an IB date', () => {
        // before 2025-06-01 -> the 2025-01-01 snapshot (100 liquid, 0 staked)
        const ib = nearLiquidStakedRaw(dailyBalances(), '2025-06-01');
        expect(ib.liquidRaw).to.equal(100e24);
        expect(ib.stakedRaw).to.equal(0);
    });

    it('splits a FIFO cost basis by the on-chain weight', () => {
        // The FIFO lumps liquid+staked: 100 NEAR remaining at cost 1000.
        // On-chain it is 4 liquid / 96 staked, so the liquid row should carry 4% of
        // the basis and the staked row 96% - exactly the double-count fix.
        const fifoCostBasis = 1000;
        const { liquidRaw, totalRaw } = nearLiquidStakedRaw(dailyBalances());
        const liquidCostBasis = fifoCostBasis * (liquidRaw / totalRaw);
        const stakedCostBasis = fifoCostBasis - liquidCostBasis;
        expect(liquidCostBasis).to.be.closeTo(40, 1e-9);
        expect(stakedCostBasis).to.be.closeTo(960, 1e-9);
    });

    it('is safe on empty input', () => {
        const { liquidRaw, stakedRaw, totalRaw } = nearLiquidStakedRaw({});
        expect(liquidRaw).to.equal(0);
        expect(stakedRaw).to.equal(0);
        expect(totalRaw).to.equal(0);
    });
});
