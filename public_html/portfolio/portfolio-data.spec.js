import { buildSampleDates, nearLiquidStakedRaw } from "./portfolio-data.js";

describe('portfolio value-over-time sampling (buildSampleDates)', () => {
    it('monthly: one point per month, first is the from date, last is today', () => {
        const dates = buildSampleDates('2026-01-01', '2026-07-02', 'month');
        expect(dates).to.deep.equal([
            '2026-01-01', '2026-02-01', '2026-03-01',
            '2026-04-01', '2026-05-01', '2026-06-01',
            '2026-07-01', '2026-07-02'
        ]);
    });

    it('monthly: a mid-month from date is kept as the first point', () => {
        const dates = buildSampleDates('2026-01-15', '2026-03-10', 'month');
        expect(dates[0]).to.equal('2026-01-15');
        expect(dates).to.include('2026-02-01');
        expect(dates).to.include('2026-03-01');
        expect(dates[dates.length - 1]).to.equal('2026-03-10');
    });

    it('weekly: steps 7 days and always ends on today', () => {
        const dates = buildSampleDates('2026-01-01', '2026-01-20', 'week');
        expect(dates).to.deep.equal([
            '2026-01-01', '2026-01-08', '2026-01-15', '2026-01-20'
        ]);
    });

    it('weekly: no duplicate final point when today lands on the step', () => {
        const dates = buildSampleDates('2026-01-01', '2026-01-15', 'week');
        expect(dates).to.deep.equal(['2026-01-01', '2026-01-08', '2026-01-15']);
    });

    it('daily: every calendar day inclusive', () => {
        const dates = buildSampleDates('2026-02-26', '2026-03-02', 'day');
        expect(dates).to.deep.equal([
            '2026-02-26', '2026-02-27', '2026-02-28',
            '2026-03-01', '2026-03-02'
        ]);
    });

    it('handles a from date equal to today (single point)', () => {
        const dates = buildSampleDates('2026-07-02', '2026-07-02', 'month');
        expect(dates).to.deep.equal(['2026-07-02']);
    });

    it('handles a from date after today gracefully (clamps to today)', () => {
        const dates = buildSampleDates('2026-08-01', '2026-07-02', 'month');
        expect(dates).to.deep.equal(['2026-07-02']);
    });
});

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
