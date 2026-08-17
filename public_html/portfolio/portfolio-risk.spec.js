import {
    computeRisk, annualisationFactor, stdev, correlation, logReturns, commonDates,
} from "./portfolio-risk.js";

// Deterministic normal draws so the statistical assertions are reproducible.
function rng(seed) {
    let a = seed >>> 0;
    const u = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return () => Math.sqrt(-2 * Math.log(Math.max(u(), 1e-12))) * Math.cos(2 * Math.PI * u());
}

function isoDates(n, start = Date.UTC(2025, 0, 1), stepDays = 1) {
    return Array.from({ length: n }, (_, i) =>
        new Date(start + i * stepDays * 86400000).toISOString().slice(0, 10));
}

/** A geometric random walk with a given per-observation sigma. */
function walk(n, sigma, seed, corrWith = null, rho = 0) {
    const normal = rng(seed);
    const prices = [100];
    for (let i = 1; i < n; i++) {
        const own = normal();
        const shock = corrWith ? rho * corrWith[i - 1] + Math.sqrt(1 - rho * rho) * own : own;
        prices.push(prices[i - 1] * Math.exp(sigma * shock));
    }
    return prices;
}

function seriesOf(dates, prices) {
    return Object.fromEntries(dates.map((d, i) => [d, prices[i]]));
}

describe('annualisationFactor', () => {
    it('is sqrt(365) when observations are one per calendar day', () => {
        const f = annualisationFactor(isoDates(366));
        expect(f).to.be.closeTo(Math.sqrt(365.25), 0.05);
    });

    it('uses calendar span, not observation count, when days are missing', () => {
        // 200 observations spread over 400 calendar days: annualising on the
        // count would overstate volatility by sqrt(2).
        const every2nd = isoDates(200, Date.UTC(2025, 0, 1), 2);
        const dense = isoDates(400);
        const sparse = annualisationFactor(every2nd);
        expect(sparse).to.be.closeTo(annualisationFactor(dense) / Math.sqrt(2), 0.15);
    });

    it('returns 0 rather than Infinity for degenerate input', () => {
        expect(annualisationFactor([])).to.equal(0);
        expect(annualisationFactor(['2025-01-01'])).to.equal(0);
        expect(annualisationFactor(['2025-01-01', '2025-01-01'])).to.equal(0);
    });
});

describe('basic statistics', () => {
    it('stdev matches a hand-computed sample', () => {
        expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).to.be.closeTo(2.13809, 1e-4);
    });

    it('correlation is +-1 for exact linear relationships', () => {
        expect(correlation([1, 2, 3, 4], [2, 4, 6, 8])).to.be.closeTo(1, 1e-12);
        expect(correlation([1, 2, 3, 4], [8, 6, 4, 2])).to.be.closeTo(-1, 1e-12);
    });

    it('logReturns skips non-positive prices instead of producing NaN', () => {
        expect(logReturns([100, 0, 110]).every(Number.isFinite)).to.equal(true);
    });
});

describe('commonDates', () => {
    it('keeps only dates every series has a positive price for', () => {
        const m = new Map([
            ['A', { '2025-01-01': 1, '2025-01-02': 1, '2025-01-03': 1 }],
            ['B', { '2025-01-02': 1, '2025-01-03': 1 }],
        ]);
        expect(commonDates(m)).to.deep.equal(['2025-01-02', '2025-01-03']);
    });

    it('ignores the stablecoin __constant marker rather than treating it as a date', () => {
        const m = new Map([['A', { __constant: 1, '2025-01-02': 1 }]]);
        expect(commonDates(m)).to.deep.equal(['2025-01-02']);
    });
});

describe('computeRisk', () => {
    const dates = isoDates(400);

    it('recovers a known volatility', () => {
        // sigma 3 % per day -> about 57 % annualised.
        const series = new Map([['A', seriesOf(dates, walk(400, 0.03, 11))]]);
        const risk = computeRisk([{ asset: 'A', weight: 1 }], series);
        expect(risk.ok).to.equal(true);
        expect(risk.assets[0].vol).to.be.closeTo(0.03 * Math.sqrt(365.25), 0.06);
        expect(risk.portfolioVol).to.be.closeTo(risk.assets[0].vol, 1e-9);
    });

    it('a single position has no diversification and carries all the risk', () => {
        const series = new Map([['A', seriesOf(dates, walk(400, 0.03, 5))]]);
        const risk = computeRisk([{ asset: 'A', weight: 1 }], series);
        expect(risk.diversification).to.be.closeTo(1, 1e-9);
        expect(risk.assets[0].riskShare).to.be.closeTo(1, 1e-9);
        expect(risk.curve).to.deep.equal([]);
    });

    it('risk shares sum to 1 and exceed the weight for the volatile leg', () => {
        const a = walk(400, 0.05, 21);
        const b = walk(400, 0.01, 22);
        const risk = computeRisk(
            [{ asset: 'A', weight: 0.5 }, { asset: 'B', weight: 0.5 }],
            new Map([['A', seriesOf(dates, a)], ['B', seriesOf(dates, b)]]),
        );
        const total = risk.assets.reduce((s, x) => s + x.riskShare, 0);
        expect(total).to.be.closeTo(1, 1e-9);
        const A = risk.assets.find(x => x.asset === 'A');
        // Equal money, five times the volatility: A dominates the risk.
        expect(A.riskShare).to.be.greaterThan(0.9);
        expect(A.weight).to.equal(0.5);
    });

    it('reports diversification above 1 only when the legs are not perfectly correlated', () => {
        const base = logReturns(walk(400, 0.03, 31));
        const a = walk(400, 0.03, 41);
        const independent = computeRisk(
            [{ asset: 'A', weight: 0.5 }, { asset: 'B', weight: 0.5 }],
            new Map([['A', seriesOf(dates, a)], ['B', seriesOf(dates, walk(400, 0.03, 42))]]),
        );
        expect(independent.diversification).to.be.greaterThan(1.2);

        // Same series twice: no diversification whatsoever.
        const identical = computeRisk(
            [{ asset: 'A', weight: 0.5 }, { asset: 'B', weight: 0.5 }],
            new Map([['A', seriesOf(dates, a)], ['B', seriesOf(dates, a)]]),
        );
        expect(identical.diversification).to.be.closeTo(1, 1e-6);
        expect(base.length).to.be.greaterThan(0);
    });

    it('the reduction curve falls as the dominant position is cut', () => {
        const risk = computeRisk(
            [{ asset: 'A', weight: 0.95 }, { asset: 'B', weight: 0.05 }],
            new Map([
                ['A', seriesOf(dates, walk(400, 0.05, 51))],
                ['B', seriesOf(dates, walk(400, 0.02, 52))],
            ]),
        );
        expect(risk.curve.length).to.be.greaterThan(3);
        expect(risk.curve[0].weight).to.be.closeTo(0.95, 1e-9);
        for (let i = 1; i < risk.curve.length; i++) {
            expect(risk.curve[i].vol).to.be.lessThan(risk.curve[i - 1].vol);
            expect(risk.curve[i].weight).to.be.lessThan(risk.curve[i - 1].weight);
        }
    });

    it('renormalises when an asset has no price series, and names it', () => {
        const risk = computeRisk(
            [{ asset: 'A', weight: 0.6 }, { asset: 'GONE', weight: 0.4 }],
            new Map([['A', seriesOf(dates, walk(400, 0.03, 61))]]),
        );
        expect(risk.omitted).to.deep.equal([{ asset: 'GONE', reason: 'no-history', observations: 0 }]);
        expect(risk.assets).to.have.lengthOf(1);
        expect(risk.assets[0].weight).to.be.closeTo(1, 1e-12);
    });

    it('says why rather than returning a bare null', () => {
        const short = isoDates(30);
        const tooShort = computeRisk(
            [{ asset: 'A', weight: 1 }],
            new Map([['A', seriesOf(short, walk(30, 0.03, 71))]]),
        );
        expect(tooShort.ok).to.equal(false);
        expect(tooShort.reason).to.equal('no-price-history');
        expect(tooShort.omitted).to.deep.equal([{ asset: 'A', reason: 'short-history', observations: 30 }]);

        const noSeries = computeRisk([{ asset: 'A', weight: 1 }], new Map());
        expect(noSeries.ok).to.equal(false);
        expect(noSeries.reason).to.equal('no-price-history');

        const nothing = computeRisk([], new Map());
        expect(nothing.ok).to.equal(false);
        expect(nothing.reason).to.equal('no-material-positions');
    });

    // The bug that kept the panel off a real portfolio: eleven exposures, four of
    // them dust tokens with a handful of price points. commonDates intersects
    // every series, so one sparse dust token collapsed the window below the
    // minimum and the whole calculation returned nothing.
    it('is not defeated by dust positions with sparse history', () => {
        const groups = [
            { asset: 'NEAR', weight: 0.969 },
            { asset: 'BTC', weight: 0.024 },
            { asset: 'ETH', weight: 0.003 },
            { asset: 'SHITZU', weight: 0.0000001 },
            { asset: 'NEKO', weight: 0.0000001 },
            { asset: 'MOON', weight: 0.0000001 },
        ];
        const sparse = isoDates(8, Date.UTC(2026, 0, 1));
        const series = new Map([
            ['NEAR', seriesOf(dates, walk(400, 0.05, 91))],
            ['BTC', seriesOf(dates, walk(400, 0.02, 92))],
            ['ETH', seriesOf(dates, walk(400, 0.03, 93))],
            ['SHITZU', seriesOf(sparse, walk(8, 0.2, 94))],
            ['NEKO', seriesOf(sparse, walk(8, 0.2, 95))],
            ['MOON', seriesOf(sparse, walk(8, 0.2, 96))],
        ]);
        const risk = computeRisk(groups, series);
        expect(risk.ok).to.equal(true);
        expect(risk.assets.map(a => a.asset)).to.deep.equal(['NEAR', 'BTC', 'ETH']);
        expect(risk.dust).to.deep.equal(['SHITZU', 'NEKO', 'MOON']);
        expect(risk.observations).to.equal(365);   // the default lookback
    });

    it('drops a material position whose own history is too short, and names it', () => {
        const risk = computeRisk(
            [{ asset: 'A', weight: 0.9 }, { asset: 'NEW', weight: 0.1 }],
            new Map([
                ['A', seriesOf(dates, walk(400, 0.03, 96))],
                ['NEW', seriesOf(isoDates(20, Date.UTC(2026, 5, 1)), walk(20, 0.05, 97))],
            ]),
        );
        expect(risk.ok).to.equal(true);
        expect(risk.omitted).to.deep.equal([{ asset: 'NEW', reason: 'short-history', observations: 20 }]);
        expect(risk.observations).to.equal(365);
        expect(risk.assets[0].weight).to.be.closeTo(1, 1e-12);
    });

    it('reports insufficient overlap when material positions barely intersect', () => {
        const risk = computeRisk(
            [{ asset: 'A', weight: 0.5 }, { asset: 'B', weight: 0.5 }],
            new Map([
                ['A', seriesOf(isoDates(200, Date.UTC(2025, 0, 1)), walk(200, 0.03, 98))],
                ['B', seriesOf(isoDates(200, Date.UTC(2025, 6, 20)), walk(200, 0.03, 99))],
            ]),
        );
        expect(risk.ok).to.equal(false);
        expect(risk.reason).to.equal('insufficient-overlap');
        expect(risk.observations).to.be.lessThan(60);
    });

    it('reports the window it actually used', () => {
        const series = new Map([['A', seriesOf(dates, walk(400, 0.03, 81))]]);
        const risk = computeRisk([{ asset: 'A', weight: 1 }], series, { lookback: 200 });
        expect(risk.observations).to.equal(200);
        expect(risk.to).to.equal(dates[dates.length - 1]);
        expect(risk.from).to.equal(dates[dates.length - 200]);
    });
});
