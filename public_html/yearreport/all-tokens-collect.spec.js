import { collectAllTokenDays, datesInPeriod } from './all-tokens-collect.js';

// Every dependency is injected, so these exercise the gathering itself: which
// tokens are asked for, what a day contributes, and what happens when a token
// cannot be read or cannot be priced.
function deps(overrides = {}) {
    return {
        calculateYearReportData: async () => ({ dailyBalances: {}, transactionsByDate: {} }),
        calculateProfitLoss: async (dailyBalances) => ({ dailyBalances }),
        getConvertedValuesForDay: async () => zero(),
        getFungibleTokenConvertedValuesForDay: async () => zero(),
        getDecimalConversionValue: () => 1e-6,
        getTokenSymbol: (t) => t.toUpperCase(),
        ...overrides,
    };
}

const zero = () => ({ stakingReward: 0, received: 0, deposit: 0, withdrawal: 0, expense: 0, conversionRate: 1 });
const day = (over = {}) => ({
    stakingRewards: 0, received: 0, deposit: 0, withdrawal: 0, expense: 0,
    totalBalance: 0, totalChange: 0, ...over,
});

const period = { periodStartDate: new Date('2026-03-01'), periodEndDate: new Date('2026-03-03') };
const run = (opts) => collectAllTokenDays({ convertToCurrency: 'nok', ...period, ...opts });

describe('gathering every token', () => {
    it('asks for native NEAR as well as the fungible tokens', async () => {
        const asked = [];
        await run({
            tokens: [{ contractId: 'btc.omft.near', symbol: 'BTC' }],
            deps: deps({
                calculateYearReportData: async (token) => {
                    asked.push(token);
                    return { dailyBalances: {}, transactionsByDate: {} };
                },
            }),
        });
        expect(asked).to.deep.equal(['', 'btc.omft.near']);
    });

    it('will not add tokens together without a currency to add them in', async () => {
        let message = '';
        try {
            await collectAllTokenDays({ ...period, convertToCurrency: '', tokens: [], deps: deps() });
        } catch (e) { message = e.message; }
        expect(message).to.include('needs a currency');
    });

    it('routes NEAR and fungible tokens through their own conversion', async () => {
        const used = [];
        await run({
            tokens: [{ contractId: 'btc.omft.near', symbol: 'BTC' }],
            deps: deps({
                calculateYearReportData: async () => ({
                    dailyBalances: { '2026-03-01': day({ deposit: 5 }) }, transactionsByDate: {},
                }),
                getConvertedValuesForDay: async () => { used.push('near'); return zero(); },
                getFungibleTokenConvertedValuesForDay: async () => { used.push('token'); return zero(); },
            }),
        });
        expect(used).to.deep.equal(['near', 'token']);
    });

    it('carries the converted figures and the units behind them', async () => {
        const { contributions } = await run({
            tokens: [],
            deps: deps({
                calculateYearReportData: async () => ({
                    dailyBalances: { '2026-03-02': day({ deposit: 2e24, totalBalance: 3e24 }) },
                    transactionsByDate: {},
                }),
                getConvertedValuesForDay: async () => ({ ...zero(), deposit: 84.5, conversionRate: 42.25 }),
            }),
        });
        const c = contributions.find(c => c.date === '2026-03-02');
        expect(c.symbol).to.equal('NEAR');
        expect(c.deposit).to.equal(84.5);
        expect(c.units.deposit).to.equal(2e24);
        expect(c.totalBalance).to.be.closeTo(3 * 42.25, 1e-6);
    });
});

describe('days it cannot price', () => {
    it('marks a day unpriced when there was something to convert', async () => {
        const { contributions } = await run({
            tokens: [],
            deps: deps({
                calculateYearReportData: async () => ({
                    dailyBalances: {
                        '2026-03-01': day({ deposit: 100 }),
                        '2026-03-02': day({ deposit: 100 }),
                    },
                    transactionsByDate: {},
                }),
                // Priced on the second day, so the first is a hole rather than an
                // asset that never had a market.
                getConvertedValuesForDay: async (rowdata, currency, date) =>
                    ({ ...zero(), conversionRate: date === '2026-03-01' ? 0 : 42 }),
            }),
        });
        expect(contributions.find(c => c.date === '2026-03-01').priced).to.equal(false);
        expect(contributions.find(c => c.date === '2026-03-02').priced).to.equal(true);
    });

    // A store collects airdropped tokens that never had a market. Treated as
    // holes they would put a warning on all 365 days and bury the one day where
    // a real asset is genuinely missing a price.
    it('reports a token with no market once instead of on every day', async () => {
        const { contributions, neverPriced } = await run({
            tokens: [{ contractId: 'scam.near', symbol: 'FREE NEAR at http://…' }],
            deps: deps({
                calculateYearReportData: async () => ({
                    dailyBalances: {
                        '2026-03-01': day({ totalBalance: 1e9 }),
                        '2026-03-02': day({ totalBalance: 1e9 }),
                    },
                    transactionsByDate: {},
                }),
                getConvertedValuesForDay: async () => ({ ...zero(), conversionRate: 30 }),
                getFungibleTokenConvertedValuesForDay: async () => ({ ...zero(), conversionRate: 0 }),
            }),
        });
        expect(neverPriced.map(t => t.token)).to.deep.equal(['scam.near']);
        expect(contributions.some(c => c.token === 'scam.near')).to.equal(false);
        expect(contributions.some(c => c.symbol === 'NEAR')).to.equal(true);
    });

    // A token that held nothing that day has no price to be missing. Flagging it
    // would put every dormant token on every day into the warning.
    it('does not call an empty day unpriced', async () => {
        const { contributions } = await run({
            tokens: [],
            deps: deps({
                calculateYearReportData: async () => ({
                    dailyBalances: { '2026-03-01': day() }, transactionsByDate: {},
                }),
                getConvertedValuesForDay: async () => ({ ...zero(), conversionRate: 0 }),
            }),
        });
        expect(contributions[0].priced).to.equal(true);
    });
});

describe('a token that cannot be read', () => {
    it('keeps the other tokens and names the one it lost', async () => {
        const { contributions, failed } = await run({
            tokens: [{ contractId: 'broken.near', symbol: 'BRK' }],
            deps: deps({
                calculateYearReportData: async (token) => {
                    if (token === 'broken.near') throw new Error('no history');
                    return { dailyBalances: { '2026-03-01': day({ deposit: 1 }) }, transactionsByDate: {} };
                },
            }),
        });
        expect(contributions.every(c => c.symbol === 'NEAR')).to.equal(true);
        expect(failed).to.deep.equal([{ token: 'broken.near', symbol: 'BRK', message: 'no history' }]);
    });
});

describe('the transactions behind a day', () => {
    it('tags each one with the token it belongs to', async () => {
        const { transactionsByDate } = await run({
            tokens: [{ contractId: 'btc.omft.near', symbol: 'BTC' }],
            deps: deps({
                calculateYearReportData: async (token) => ({
                    dailyBalances: { '2026-03-01': day({ deposit: 1 }) },
                    transactionsByDate: { '2026-03-01': [{ hash: token || 'near-tx' }] },
                }),
            }),
        });
        expect(transactionsByDate['2026-03-01'].map(t => t.symbol)).to.deep.equal(['NEAR', 'BTC']);
        expect(transactionsByDate['2026-03-01'][1].decimalConversionValue).to.equal(1e-6);
    });
});

describe('the days in a period', () => {
    it('runs from the first to the last, inclusive', () => {
        expect(datesInPeriod(new Date('2026-03-01'), new Date('2026-03-04')))
            .to.deep.equal(['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04']);
    });
});
