import { collectAllTokenDays, datesInPeriod, portfolioFlows } from './all-tokens-collect.js';

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

// Summing each token's deposits and withdrawals answers a different question
// than "what was added to the portfolio". These pin the difference.
describe('what crossed the portfolio edge', () => {
    const prices = (entries) => new Map(Object.entries(entries));
    const move = (over) => ({ date: '2026-03-01', units: 1, kind: 'deposit', ...over });

    it('counts a swap as neither added nor taken out', () => {
        const byDate = portfolioFlows({
            movements: [
                move({ token: 'wnear', symbol: 'wNEAR', units: 100, kind: 'withdrawal', swapKey: 'tx1' }),
                move({ token: 'usdc', symbol: 'USDC', units: 1000, kind: 'deposit', swapKey: 'tx1' }),
            ],
            priceByToken: prices({ wnear: { '2026-03-01': 10 }, usdc: { '2026-03-01': 1 } }),
        });
        expect(byDate['2026-03-01'].deposit).to.equal(0);
        expect(byDate['2026-03-01'].withdrawal).to.equal(0);
        expect(byDate['2026-03-01'].internalCount).to.equal(1);
        expect(byDate['2026-03-01'].internalValue).to.equal(1000);
    });

    it('still counts money that genuinely came in or went out', () => {
        const byDate = portfolioFlows({
            movements: [
                move({ token: 'near', symbol: 'NEAR', units: 50, kind: 'deposit', swapKey: 'tx2' }),
                move({ token: 'near', symbol: 'NEAR', units: 20, kind: 'withdrawal', swapKey: 'tx3' }),
            ],
            priceByToken: prices({ near: { '2026-03-01': 30 } }),
        });
        expect(byDate['2026-03-01'].deposit).to.equal(1500);
        expect(byDate['2026-03-01'].withdrawal).to.equal(600);
    });

    // The gap between two legs at end-of-day prices is mostly the intraday move.
    // Netting by value would book that as a deposit nobody made; recognising the
    // pair by its transaction and removing it whole does not.
    it('does not turn the intraday move into a flow', () => {
        const byDate = portfolioFlows({
            movements: [
                move({ token: 'wnear', units: 100, kind: 'withdrawal', swapKey: 'tx1' }),
                move({ token: 'usdc', units: 1050, kind: 'deposit', swapKey: 'tx1' }),
            ],
            priceByToken: prices({ wnear: { '2026-03-01': 10 }, usdc: { '2026-03-01': 1 } }),
        });
        expect(byDate['2026-03-01'].deposit).to.equal(0);
        expect(byDate['2026-03-01'].withdrawal).to.equal(0);
    });

    // The flow panel refuses over one of these. A year of days cannot disappear
    // over a single transaction, so the money is counted and the day marked.
    it('counts a transaction whose sides do not match, and marks it', () => {
        const byDate = portfolioFlows({
            movements: [
                move({ token: 'wnear', units: 100, kind: 'withdrawal', swapKey: 'tx1' }),
                move({ token: 'usdc', units: 10, kind: 'deposit', swapKey: 'tx1' }),
            ],
            priceByToken: prices({ wnear: { '2026-03-01': 10 }, usdc: { '2026-03-01': 1 } }),
        });
        expect(byDate['2026-03-01'].withdrawal).to.equal(1000);
        expect(byDate['2026-03-01'].deposit).to.equal(10);
        expect(byDate['2026-03-01'].ambiguous).to.have.lengthOf(1);
    });

    it('drops tokens with no market rather than pricing them at nothing', () => {
        const byDate = portfolioFlows({
            movements: [move({ token: 'scam.near', units: 1e9, kind: 'deposit' })],
            priceByToken: prices({}),
            skip: new Set(['scam.near']),
        });
        expect(byDate['2026-03-01']).to.equal(undefined);
    });

    // Understating a flow silently is the failure worth avoiding: the day looks
    // quieter than it was.
    it('names a movement it could not price instead of counting it as zero', () => {
        const byDate = portfolioFlows({
            movements: [move({ token: 'moon.near', symbol: 'MOON', units: 100, kind: 'deposit' })],
            priceByToken: prices({ 'moon.near': { '2026-02-01': 5 } }),
        });
        expect(byDate['2026-03-01'].deposit).to.equal(0);
        expect(byDate['2026-03-01'].unpriced).to.deep.equal(['MOON']);
    });

    it('keeps each day separate', () => {
        const byDate = portfolioFlows({
            movements: [
                move({ date: '2026-03-01', token: 'near', units: 1, kind: 'deposit' }),
                move({ date: '2026-03-02', token: 'near', units: 2, kind: 'withdrawal' }),
            ],
            priceByToken: prices({ near: { '2026-03-01': 30, '2026-03-02': 30 } }),
        });
        expect(byDate['2026-03-01'].deposit).to.equal(30);
        expect(byDate['2026-03-02'].withdrawal).to.equal(60);
        expect(byDate['2026-03-01'].withdrawal).to.equal(0);
    });
});
