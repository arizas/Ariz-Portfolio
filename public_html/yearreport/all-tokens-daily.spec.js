import { combineDailyRows, daysWithActivity, ALL_TOKENS } from "./all-tokens-daily.js";

const day = (token, symbol, date, extra = {}) => ({
    token, symbol, date,
    stakingReward: 0, received: 0, deposit: 0, withdrawal: 0, expense: 0,
    ...extra,
});

describe('combineDailyRows', () => {
    it('adds every token that moved on a day into one row', () => {
        const { rows } = combineDailyRows([
            day('', 'NEAR', '2026-07-08', { withdrawal: 338.28 }),
            day('nbtc.bridge.near', 'BTC', '2026-07-08', { deposit: 335.96 }),
        ]);
        expect(rows).to.have.lengthOf(1);
        expect(rows[0].withdrawal).to.be.closeTo(338.28, 1e-9);
        expect(rows[0].deposit).to.be.closeTo(335.96, 1e-9);
        // Which is the point: a swap nets to roughly the spread, in one place.
        expect(rows[0].net).to.be.closeTo(-2.32, 1e-9);
    });

    it('keeps the per-token breakdown behind the total', () => {
        const { rows } = combineDailyRows([
            day('', 'NEAR', '2026-07-08', { withdrawal: 338.28 }),
            day('nbtc.bridge.near', 'BTC', '2026-07-08', { deposit: 335.96 }),
        ]);
        expect(rows[0].tokens.map(t => t.symbol).sort()).to.deep.equal(['BTC', 'NEAR']);
    });

    it('orders days newest first and tokens by how much moved', () => {
        const { rows } = combineDailyRows([
            day('a', 'A', '2026-01-01', { deposit: 5 }),
            day('b', 'B', '2026-03-01', { deposit: 10 }),
            day('c', 'C', '2026-03-01', { deposit: 900 }),
        ]);
        expect(rows.map(r => r.date)).to.deep.equal(['2026-03-01', '2026-01-01']);
        expect(rows[0].tokens.map(t => t.symbol)).to.deep.equal(['C', 'B']);
    });

    it('leaves a token out of the breakdown when nothing moved for it', () => {
        const { rows } = combineDailyRows([
            day('a', 'A', '2026-03-01', { deposit: 5 }),
            day('b', 'B', '2026-03-01'),                   // held, but idle
        ]);
        expect(rows[0].tokens.map(t => t.symbol)).to.deep.equal(['A']);
    });

    it('still sums balances for an idle token', () => {
        const { rows } = combineDailyRows([
            day('a', 'A', '2026-03-01', { totalBalance: 100 }),
            day('b', 'B', '2026-03-01', { totalBalance: 250 }),
        ]);
        expect(rows[0].totalBalance).to.equal(350);
    });

    // A day whose total silently omits a leg looks complete and is not.
    it('records an unpriced token instead of adding it as zero', () => {
        const { rows, totals } = combineDailyRows([
            day('a', 'A', '2026-03-01', { deposit: 100 }),
            day('x', 'NPRO', '2026-03-01', { deposit: 999, priced: false, movedUnits: true }),
        ]);
        expect(rows[0].deposit).to.equal(100);
        expect(rows[0].unpriced).to.deep.equal(['NPRO']);
        expect(totals.unpriced).to.deep.equal(['NPRO']);
        // It is still listed, so the reader can see what was left out.
        expect(rows[0].tokens.map(t => t.symbol)).to.include('NPRO');
    });

    // A token that merely sits there unpriced makes the balance short, not the
    // flows. Told apart, because otherwise one dormant token puts a warning on
    // every day of the year and buries the days that actually moved.
    it('separates a movement it could not price from a balance it could not value', () => {
        const { rows, totals } = combineDailyRows([
            day('a', 'A', '2026-03-01', { deposit: 100 }),
            day('x', 'NPRO', '2026-03-01', { priced: false, movedUnits: true }),
            day('y', 'SHITZU', '2026-03-01', { priced: false, movedUnits: false }),
        ]);
        expect(rows[0].unpriced).to.deep.equal(['NPRO']);
        expect(rows[0].unvalued).to.deep.equal(['SHITZU']);
        expect(totals.unpriced).to.deep.equal(['NPRO']);
        expect(totals.unvalued).to.deep.equal(['SHITZU']);
    });

    it('totals every column across the period', () => {
        const { totals } = combineDailyRows([
            day('a', 'A', '2026-03-01', { deposit: 100, withdrawal: 30 }),
            day('a', 'A', '2026-03-02', { deposit: 50, expense: 5, received: 7 }),
        ]);
        expect(totals.deposit).to.equal(150);
        expect(totals.withdrawal).to.equal(30);
        expect(totals.expense).to.equal(5);
        expect(totals.received).to.equal(7);
        expect(totals.net).to.equal(150 + 7 - 30 - 5);
        expect(totals.days).to.equal(2);
    });

    it('carries profit and loss through', () => {
        const { rows, totals } = combineDailyRows([
            day('a', 'A', '2026-03-01', { profit: 40 }),
            day('b', 'B', '2026-03-01', { loss: 15 }),
        ]);
        expect(rows[0].profit).to.equal(40);
        expect(rows[0].loss).to.equal(15);
        expect(totals.profit).to.equal(40);
    });

    it('survives empty and malformed input', () => {
        expect(combineDailyRows([]).rows).to.deep.equal([]);
        expect(combineDailyRows([{ symbol: 'X' }]).rows).to.deep.equal([]);
        expect(combineDailyRows([]).totals.days).to.equal(0);
    });
});

describe('daysWithActivity', () => {
    it('keeps only the days something happened on', () => {
        const { rows } = combineDailyRows([
            day('a', 'A', '2026-03-01', { deposit: 5 }),
            day('a', 'A', '2026-03-02', { totalBalance: 500 }),
        ]);
        expect(daysWithActivity(rows).map(r => r.date)).to.deep.equal(['2026-03-01']);
    });

    it('keeps a day that could not be priced, since that is worth seeing', () => {
        const { rows } = combineDailyRows([day('x', 'NPRO', '2026-03-01', { deposit: 9, priced: false })]);
        expect(daysWithActivity(rows)).to.have.lengthOf(1);
    });
});

describe('ALL_TOKENS', () => {
    it('cannot collide with a contract id', () => {
        expect(ALL_TOKENS).to.equal('__all__');
        expect(ALL_TOKENS.endsWith('.near')).to.equal(false);
    });
});
