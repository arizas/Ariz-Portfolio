import { economicAsset, groupHoldings, effectivePositions, CASH_GROUP } from "./asset-groups.js";

describe('economicAsset', () => {
    it('folds NEAR, its wrapper and its liquid-staking tokens into one exposure', () => {
        for (const s of ['NEAR', 'wNEAR', 'stNEAR', 'LiNEAR', 'NEARX']) {
            expect(economicAsset(s)).to.equal('NEAR');
        }
    });

    it('folds the BTC and ETH wrappers', () => {
        for (const s of ['BTC', 'WBTC', 'nBTC', 'cbBTC']) expect(economicAsset(s)).to.equal('BTC');
        for (const s of ['ETH', 'WETH', 'stETH', 'wstETH']) expect(economicAsset(s)).to.equal('ETH');
    });

    it('treats stablecoins as one cash exposure', () => {
        for (const s of ['USDC', 'USDC.e', 'USDT', 'USDT.e', 'DAI', 'USN']) {
            expect(economicAsset(s)).to.equal(CASH_GROUP);
        }
    });

    it('is case-insensitive', () => {
        expect(economicAsset('stnear')).to.equal('NEAR');
        expect(economicAsset('WbTc')).to.equal('BTC');
    });

    it('leaves an unknown symbol as its own group rather than guessing', () => {
        expect(economicAsset('SHITZU')).to.equal('SHITZU');
        expect(economicAsset('ZEC')).to.equal('ZEC');
    });

    it('does not throw on a missing symbol', () => {
        expect(economicAsset(undefined)).to.equal('?');
        expect(economicAsset('')).to.equal('?');
    });
});

describe('groupHoldings', () => {
    // Shaped like a real account: NEAR spread across four tokens plus staking,
    // and a small BTC position in the confidential bucket.
    const portfolio = {
        holdings: [
            { token: '', symbol: 'NEAR', displaySymbol: 'NEAR', amount: 380, value: 628, costBasis: 500 },
            { token: 'meta-pool.near', symbol: 'STNEAR', displaySymbol: 'stNEAR', amount: 254, value: 623, costBasis: 400, excluded: true },
            { token: 'wrap.near', symbol: 'WNEAR', displaySymbol: 'wNEAR', amount: 61, value: 101, costBasis: 90 },
            { token: 'confidential:nep141:nbtc.bridge.near', symbol: 'BTC', displaySymbol: 'BTC ( Confidential / Bitcoin )', amount: 0.00696, value: 439, costBasis: 452 },
        ],
        stakedAmount: 8728,
        stakedValue: 14364,
        stakedCostBasis: 9000,
        totalValue: 1168,      // deliberately excludes stNEAR and staking
    };

    it('collapses four NEAR rows plus staking into a single exposure', () => {
        const { groups } = groupHoldings(portfolio);
        expect(groups.map(g => g.asset)).to.deep.equal(['NEAR', 'BTC']);
        const near = groups[0];
        expect(near.value).to.equal(628 + 623 + 101 + 14364);
        expect(near.members.map(m => m.displaySymbol)).to.deep.equal(
            ['NEAR (staked)', 'NEAR', 'stNEAR', 'wNEAR']
        );
    });

    it('reports the concentration the token table hides', () => {
        const { groups, total } = groupHoldings(portfolio);
        expect(total).to.equal(628 + 623 + 101 + 14364 + 439);
        // 97 %, not the 89 % the largest single row would suggest.
        expect(groups[0].weight).to.be.closeTo(0.973, 0.001);
        expect(groups[1].weight).to.be.closeTo(0.027, 0.001);
    });

    it('builds the denominator from grouped values, not portfolio.totalValue', () => {
        // totalValue omits stNEAR and staked NEAR by design; using it would put
        // the weights far above 1.
        const { groups, total } = groupHoldings(portfolio);
        expect(total).to.be.greaterThan(portfolio.totalValue);
        const sum = groups.reduce((a, g) => a + g.weight, 0);
        expect(sum).to.be.closeTo(1, 1e-12);
    });

    it('sums cost basis and unrealized per group', () => {
        const { groups } = groupHoldings(portfolio);
        expect(groups[0].costBasis).to.equal(500 + 400 + 90 + 9000);
        expect(groups[0].unrealized).to.equal(groups[0].value - groups[0].costBasis);
        // BTC is under water in this fixture; the sign must survive grouping.
        expect(groups[1].unrealized).to.equal(439 - 452);
    });

    it('separates unpriced holdings instead of counting them as zero', () => {
        const { groups, unpriced, total } = groupHoldings({
            holdings: [
                { token: '', symbol: 'NEAR', displaySymbol: 'NEAR', amount: 100, value: 165, costBasis: 100 },
                { token: 'x.near', symbol: 'SHITZU', displaySymbol: 'SHITZU', amount: 42, value: null, costBasis: 0 },
            ],
        });
        expect(groups).to.have.lengthOf(1);
        expect(total).to.equal(165);
        expect(unpriced).to.deep.equal([{ symbol: 'SHITZU', displaySymbol: 'SHITZU', amount: 42 }]);
    });

    it('handles an empty portfolio without dividing by zero', () => {
        const { groups, total, herfindahl } = groupHoldings({ holdings: [] });
        expect(groups).to.deep.equal([]);
        expect(total).to.equal(0);
        expect(herfindahl).to.equal(null);
    });

    it('ignores staking when there is none', () => {
        const { groups } = groupHoldings({
            holdings: [{ token: '', symbol: 'NEAR', displaySymbol: 'NEAR', amount: 100, value: 165, costBasis: 100 }],
            stakedValue: 0,
        });
        expect(groups[0].members).to.have.lengthOf(1);
    });

    it('keeps an unknown token as its own group', () => {
        const { groups } = groupHoldings({
            holdings: [
                { token: '', symbol: 'NEAR', displaySymbol: 'NEAR', amount: 100, value: 100, costBasis: 100 },
                { token: 'zec.omft.near', symbol: 'ZEC', displaySymbol: 'ZEC ( NEAR Intents )', amount: 1, value: 100, costBasis: 100 },
            ],
        });
        expect(groups.map(g => g.asset).sort()).to.deep.equal(['NEAR', 'ZEC']);
    });
});

describe('herfindahl and effective positions', () => {
    const equalWeight = n => ({
        holdings: Array.from({ length: n }, (_, i) => ({
            token: `t${i}`, symbol: `TOK${i}`, displaySymbol: `TOK${i}`, amount: 1, value: 100, costBasis: 100,
        })),
    });

    it('is 1/N for N equally weighted assets', () => {
        for (const n of [1, 2, 5, 10]) {
            const { herfindahl } = groupHoldings(equalWeight(n));
            expect(herfindahl).to.be.closeTo(1 / n, 1e-12);
            expect(effectivePositions(herfindahl)).to.be.closeTo(n, 1e-9);
        }
    });

    it('approaches 1 as one position dominates', () => {
        const { herfindahl } = groupHoldings({
            holdings: [
                { token: 'a', symbol: 'A', displaySymbol: 'A', amount: 1, value: 9700, costBasis: 1 },
                { token: 'b', symbol: 'B', displaySymbol: 'B', amount: 1, value: 300, costBasis: 1 },
            ],
        });
        expect(herfindahl).to.be.closeTo(0.97 ** 2 + 0.03 ** 2, 1e-6);
        expect(effectivePositions(herfindahl)).to.be.lessThan(1.1);
    });

    it('returns null rather than Infinity for an empty portfolio', () => {
        expect(effectivePositions(null)).to.equal(null);
        expect(effectivePositions(0)).to.equal(null);
    });
});
