import { decomposeFlows } from "./flow-decomposition.js";

// A price book keyed by token and date; anything absent is genuinely unknown.
function prices(book) {
    return (token, date) => book[`${token}|${date}`] ?? null;
}
const NEAR = '', BTC = 'nbtc.bridge.near', ZEC = 'zec.omft.near';

describe('decomposeFlows — the identity', () => {
    it('splits a rise into what was added and what was earned', () => {
        const r = decomposeFlows({
            movements: [{ date: '2026-03-01', token: NEAR, units: 1000, kind: 'deposit' }],
            price: prices({ '|2026-03-01': 2 }),
            opening: 1000,
            closing: 4000,
        });
        expect(r.ok).to.equal(true);
        expect(r.netFlow).to.equal(2000);
        expect(r.gain).to.equal(1000);
        // opening + netFlow + gain === closing, always
        expect(r.opening + r.netFlow + r.gain).to.equal(r.closing);
    });

    it('a portfolio that only grew by deposits shows no gain', () => {
        const r = decomposeFlows({
            movements: [{ date: '2026-03-01', token: NEAR, units: 500, kind: 'deposit' }],
            price: prices({ '|2026-03-01': 2 }),
            opening: 1000, closing: 2000,
        });
        expect(r.gain).to.equal(0);
    });

    it('counts a withdrawal as money leaving, not as a loss', () => {
        const r = decomposeFlows({
            movements: [{ date: '2026-03-01', token: NEAR, units: 500, kind: 'withdrawal' }],
            price: prices({ '|2026-03-01': 2 }),
            opening: 2000, closing: 1000,
        });
        expect(r.netFlow).to.equal(-1000);
        expect(r.gain).to.equal(0);
    });

    it('treats an expense as an outflow', () => {
        const r = decomposeFlows({
            movements: [{ date: '2026-03-01', token: NEAR, units: 100, kind: 'expense' }],
            price: prices({ '|2026-03-01': 2 }),
            opening: 1000, closing: 800,
        });
        expect(r.withdrawals).to.equal(200);
        expect(r.gain).to.equal(0);
    });
});

describe('income versus yield', () => {
    const movement = kind => ([{ date: '2026-03-01', token: NEAR, units: 100, kind }]);

    it('income is a flow — the money came from outside', () => {
        const r = decomposeFlows({
            movements: movement('income'),
            price: prices({ '|2026-03-01': 2 }), opening: 1000, closing: 1200,
        });
        expect(r.income).to.equal(200);
        expect(r.netFlow).to.equal(200);
        expect(r.gain).to.equal(0);
    });

    // NPRO paid daily for staking in the NPRO pool is the case that forced this
    // distinction: a different token from what was staked, but still return on
    // capital already held.
    it('yield is not a flow — it is what the capital earned', () => {
        const r = decomposeFlows({
            movements: movement('yield'),
            price: prices({ '|2026-03-01': 2 }), opening: 1000, closing: 1200,
        });
        expect(r.netFlow).to.equal(0);
        expect(r.yieldReceived).to.equal(200);
        expect(r.gain).to.equal(200);
    });
});

describe('swaps', () => {
    // The 2026-07-21 swap, with the real numbers. Priced at end of day the two
    // legs differ by $20 — the intraday move — which as a flow would be a
    // deposit that never happened, and would hand that gain to any benchmark.
    const swapLegs = [
        { date: '2026-07-21', token: NEAR, units: 178.7, kind: 'withdrawal', swapKey: 'tx1' },
        { date: '2026-07-21', token: BTC, units: 0.00551473, kind: 'deposit', swapKey: 'tx1' },
    ];
    const eod = prices({ '|2026-07-21': 1.9192, 'nbtc.bridge.near|2026-07-21': 65661 });

    it('contributes nothing, whatever end-of-day pricing did to the legs', () => {
        const r = decomposeFlows({ movements: swapLegs, price: eod, opening: 1000, closing: 1020 });
        expect(r.ok).to.equal(true);
        expect(r.netFlow).to.equal(0);
        expect(r.internal).to.have.lengthOf(1);
    });

    it('leaves the intraday move in gain, where it belongs', () => {
        const r = decomposeFlows({ movements: swapLegs, price: eod, opening: 1000, closing: 1020 });
        expect(r.gain).to.equal(20);
    });

    it('recognises a confidential swap by its shared deposit address', () => {
        const r = decomposeFlows({
            movements: [
                { date: '2026-08-14', token: BTC, units: 0.00159604, kind: 'withdrawal', swapKey: 'confidential:6a4d34cb' },
                { date: '2026-08-14', token: NEAR, units: 62.89, kind: 'deposit', swapKey: 'confidential:6a4d34cb' },
            ],
            price: prices({ 'nbtc.bridge.near|2026-08-14': 62675, '|2026-08-14': 1.59 }),
            opening: 100, closing: 100,
        });
        expect(r.netFlow).to.equal(0);
        expect(r.internal).to.have.lengthOf(1);
    });

    it('does not net a hash with only one side — the other half is outside', () => {
        const r = decomposeFlows({
            movements: [{ date: '2026-03-01', token: NEAR, units: 100, kind: 'deposit', swapKey: 'tx9' }],
            price: prices({ '|2026-03-01': 2 }), opening: 0, closing: 200,
        });
        expect(r.netFlow).to.equal(200);
        expect(r.internal).to.have.lengthOf(0);
    });

    // A NEAR transaction can carry several actions, so one hash can hold a swap
    // and a real transfer at once. Netting it whole would erase the transfer.
    // The tolerance has to clear normal intraday movement: the real 07-21 swap
    // above is 5.3 % apart at end-of-day prices with nothing wrong with it.
    it('accepts a swap whose legs moved apart intraday', () => {
        const r = decomposeFlows({
            movements: [
                { date: '2026-03-01', token: NEAR, units: 100, kind: 'withdrawal', swapKey: 'v' },
                { date: '2026-03-01', token: BTC, units: 1.12, kind: 'deposit', swapKey: 'v' },
            ],
            price: prices({ '|2026-03-01': 1, 'nbtc.bridge.near|2026-03-01': 100 }),
            opening: 0, closing: 12,
        });
        expect(r.ok).to.equal(true);
        expect(r.netFlow).to.equal(0);
        expect(r.gain).to.equal(12);
    });

    it('refuses a hash whose two sides do not match, instead of netting it', () => {
        const r = decomposeFlows({
            movements: [
                { date: '2026-03-01', token: NEAR, units: 100, kind: 'withdrawal', swapKey: 'batch' },
                { date: '2026-03-01', token: BTC, units: 1, kind: 'deposit', swapKey: 'batch' },
            ],
            price: prices({ '|2026-03-01': 2, 'nbtc.bridge.near|2026-03-01': 1000 }),
            opening: 0, closing: 0,
        });
        expect(r.ok).to.equal(false);
        expect(r.reason).to.equal('ambiguous-swap');
        expect(r.suspect[0].gap).to.be.greaterThan(0.25);
    });

    it('accepts a swap whose legs differ only by the solver spread', () => {
        const r = decomposeFlows({
            movements: [
                { date: '2026-03-01', token: NEAR, units: 100, kind: 'withdrawal', swapKey: 's' },
                { date: '2026-03-01', token: BTC, units: 0.99, kind: 'deposit', swapKey: 's' },
            ],
            price: prices({ '|2026-03-01': 1, 'nbtc.bridge.near|2026-03-01': 100 }),
            opening: 0, closing: 0,
        });
        expect(r.ok).to.equal(true);
        expect(r.internal[0].gap).to.be.lessThan(0.05);
    });
});

describe('prices it cannot get', () => {
    it('refuses rather than treating a missing price as zero', () => {
        const r = decomposeFlows({
            movements: [{ date: '2026-03-01', token: BTC, units: 1, kind: 'deposit' }],
            price: prices({}), opening: 0, closing: 1000,
        });
        expect(r.ok).to.equal(false);
        expect(r.reason).to.equal('unpriced-flows');
        expect(r.unpriced[0].token).to.equal(BTC);
    });

    // Otherwise any worthless airdrop gets a veto over the whole calculation.
    it('ignores a token that has no market anywhere, and says which', () => {
        const r = decomposeFlows({
            movements: [
                { date: '2026-03-01', token: 'scam.near', symbol: 'SCAM', units: 1e6, kind: 'deposit' },
                { date: '2026-03-01', token: NEAR, units: 100, kind: 'deposit' },
            ],
            price: prices({ '|2026-03-01': 2 }),
            neverPriced: new Set(['scam.near']),
            opening: 0, closing: 200,
        });
        expect(r.ok).to.equal(true);
        expect(r.netFlow).to.equal(200);
        expect(r.ignoredNoMarket).to.deep.equal(['scam.near']);
    });
});

describe('reconciliation against the FIFO engine', () => {
    it('agrees when the flows are right', () => {
        // Held something worth 100 at cost 60; deposited 50 more at cost 50;
        // now worth 200 at cost 110.
        const r = decomposeFlows({
            movements: [{ date: '2026-03-01', token: NEAR, units: 25, kind: 'deposit' }],
            price: prices({ '|2026-03-01': 2 }),
            opening: 100, closing: 200,
            fifo: { realized: 0, unrealizedOpening: 40, unrealizedNow: 90 },
        });
        expect(r.gain).to.equal(50);
        expect(r.reconciliation.agrees).to.equal(true);
        expect(r.reconciliation.expected).to.equal(50);
    });

    // Yield arrives at market value, so it lifts the portfolio without moving
    // unrealized P/L. Without the yield term every staking account would look
    // like a discrepancy.
    it('accounts for yield, which never touches unrealized P/L', () => {
        const r = decomposeFlows({
            movements: [{ date: '2026-03-01', token: NEAR, units: 10, kind: 'yield' }],
            price: prices({ '|2026-03-01': 2 }),
            opening: 100, closing: 120,
            fifo: { realized: 0, unrealizedOpening: 0, unrealizedNow: 0 },
        });
        expect(r.gain).to.equal(20);
        expect(r.reconciliation.expected).to.equal(20);
        expect(r.reconciliation.agrees).to.equal(true);
    });

    // A known blind spot, pinned so it is not mistaken for coverage. Income and
    // yield both arrive as new lots at market value, so the FIFO engine cannot
    // tell them apart either — and the yield term in the identity moves in step
    // with the misclassification, so the check reports agreement. Getting this
    // right depends on the counterparty configuration, not on arithmetic.
    it('CANNOT catch yield misclassified as a deposit — the check is circular here', () => {
        const r = decomposeFlows({
            movements: [{ date: '2026-03-01', token: NEAR, units: 10, kind: 'deposit' }],
            price: prices({ '|2026-03-01': 2 }),
            opening: 100, closing: 120,
            fifo: { realized: 0, unrealizedOpening: 0, unrealizedNow: 0 },
        });
        expect(r.gain).to.equal(0);          // the 20 was booked as a deposit
        expect(r.reconciliation.agrees).to.equal(true);   // and nothing objects
    });

    // What it does catch: a flow that should have netted away and did not, which
    // is the error that would otherwise reach a chart unnoticed.
    it('catches a swap leg left in as a flow', () => {
        const r = decomposeFlows({
            movements: [{ date: '2026-03-01', token: NEAR, units: 100, kind: 'deposit' }],
            price: prices({ '|2026-03-01': 2 }),
            opening: 1000, closing: 1000,
            fifo: { realized: 0, unrealizedOpening: 0, unrealizedNow: 0 },
        });
        expect(r.reconciliation.agrees).to.equal(false);
        expect(r.reconciliation.difference).to.equal(-200);
    });

    it('carries realized profit through', () => {
        const r = decomposeFlows({
            movements: [], price: prices({}),
            opening: 100, closing: 130,
            fifo: { realized: 30, unrealizedOpening: 0, unrealizedNow: 0 },
        });
        expect(r.gain).to.equal(30);
        expect(r.reconciliation.agrees).to.equal(true);
    });

    it('reports that it could not check when the FIFO figures are absent', () => {
        const r = decomposeFlows({ movements: [], price: prices({}), opening: 0, closing: 0 });
        expect(r.reconciliation.available).to.equal(false);
    });

    it('scales its tolerance to the size of the portfolio', () => {
        const near = decomposeFlows({
            movements: [], price: prices({}),
            opening: 0, closing: 100000,
            fifo: { realized: 100500, unrealizedOpening: 0, unrealizedNow: 0 },
        });
        // 500 out of 100 000 is inside 1 %.
        expect(near.reconciliation.agrees).to.equal(true);
        const far = decomposeFlows({
            movements: [], price: prices({}),
            opening: 0, closing: 100000,
            fifo: { realized: 120000, unrealizedOpening: 0, unrealizedNow: 0 },
        });
        expect(far.reconciliation.agrees).to.equal(false);
    });
});

describe('movements too small to matter', () => {
    const tiny = [{ date: '2026-08-19', token: 'npro.nearmobile.near', symbol: 'NPRO', units: 20, kind: 'yield' }];

    // Price history routinely lags the last few days. Refusing over a movement
    // that cannot move the answer trades one wrong result for no result.
    it('skips an unpriceable movement whose value cannot matter', () => {
        const r = decomposeFlows({
            movements: tiny,
            price: () => null,
            estimateValue: (_t, units) => units * 2,      // 40 against 300 000
            opening: 300000, closing: 304000,
        });
        expect(r.ok).to.equal(true);
        expect(r.immaterial).to.have.lengthOf(1);
        expect(r.immaterial[0].symbol).to.equal('NPRO');
        expect(r.gain).to.equal(4000);
    });

    it('still refuses when the bound could move the answer', () => {
        const r = decomposeFlows({
            movements: [{ date: '2026-08-19', token: 'x', symbol: 'X', units: 1000, kind: 'deposit' }],
            price: () => null,
            estimateValue: (_t, units) => units * 50,     // 50 000 against 304 000
            opening: 300000, closing: 304000,
        });
        expect(r.ok).to.equal(false);
        expect(r.reason).to.equal('unpriced-flows');
    });

    it('refuses when it cannot even bound the value', () => {
        const r = decomposeFlows({
            movements: tiny, price: () => null, estimateValue: () => null,
            opening: 300000, closing: 304000,
        });
        expect(r.ok).to.equal(false);
    });

    it('refuses when given no way to estimate at all', () => {
        const r = decomposeFlows({ movements: tiny, price: () => null, opening: 300000, closing: 304000 });
        expect(r.ok).to.equal(false);
    });

    it('judges the whole set together, not one movement at a time', () => {
        // Individually each is under the floor; together they are not.
        const many = Array.from({ length: 20 }, (_, i) => ({
            date: `2026-08-${String(i + 1).padStart(2, '0')}`, token: 'x', symbol: 'X', units: 100, kind: 'deposit',
        }));
        const r = decomposeFlows({
            movements: many, price: () => null, estimateValue: (_t, u) => u * 2,
            opening: 300000, closing: 304000,
        });
        expect(r.ok).to.equal(false);
    });
});
