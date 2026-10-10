import './yearreport-page.component.js';
import { collectAllTokenDays } from './all-tokens-collect.js';

// The combined row shows a profit; this is where it has to be explained. Each
// disposal names the lot it consumed, when it was acquired and at what price,
// what it fetched, and how that exit value was decided.
describe('what a day realized, in the day detail', () => {
    const page = () => {
        const el = document.createElement('year-report-page');
        el.displaySymbols = new Map();
        el.convertToCurrency = 'nok';
        return el;
    };
    // petersalomonsen.near, 2026-09-28: 1 200 NEAR wrapped, consuming a lot
    // bought on 2021-05-05 at 9.78 NOK, valued on the wNEAR received.
    const near = {
        token: '', symbol: 'NEAR', received: 0, deposit: 0, withdrawal: 60928.42, expense: 0, stakingReward: 45.39,
        profit: 49188.68, loss: 0, decimalConversionValue: 1e-24,
        realizations: [{
            amount: 1200e24, initialConvertedValue: 11739.74, convertedValue: 60928.42, conversionRate: 50.7736,
            profit: 49188.68, loss: 0,
            position: { date: '2021-05-05', conversionRate: 9.78 },
            swap: { key: 'AqrfpoHb', valuedBy: 'destination', authority: ['wNEAR'] },
        }],
    };
    const flows = { deposit: 0, withdrawal: 0.03, internalCount: 2, internalValue: 61022, transferCount: 5, transferValue: 111893, ambiguous: [] };
    const nok = (n) => Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

    it('shows profit and loss per token beside what it moved', () => {
        const html = page().transactionsModalBody({ transactions: [], allTokens: true, tokenBreakdown: [near], flows });
        expect(html).to.include('<th>Profit</th><th>Loss</th>');
        expect(html).to.include(nok(49188.68));
    });

    it('names the lot, its entry price, the exit price and what the exit was valued on', () => {
        const html = page().transactionsModalBody({ transactions: [], allTokens: true, tokenBreakdown: [near], flows });
        expect(html).to.include('Realized this day');
        expect(html).to.include('2021-05-05');
        expect(html).to.include(nok(11739.74 / 1200));   // entry per unit
        expect(html).to.include(nok(50.7736));           // exit per unit
        expect(html).to.include(nok(11739.74));          // cost
        expect(html).to.include(nok(60928.42));          // proceeds
        expect(html).to.include('the wNEAR received');
    });

    it('says a plain sale was valued at the close', () => {
        const sale = { ...near, realizations: [{ ...near.realizations[0], swap: undefined }] };
        const html = page().transactionsModalBody({ transactions: [], allTokens: true, tokenBreakdown: [sale], flows });
        expect(html).to.include("the day's close");
    });

    it('shows nothing of the kind on a day without disposals', () => {
        const html = page().transactionsModalBody({ transactions: [], allTokens: true, tokenBreakdown: [{ ...near, realizations: [] }], flows });
        expect(html).to.not.include('Realized this day');
    });

    it('escapes the symbols a swap was valued on', () => {
        const scam = { ...near, realizations: [{ ...near.realizations[0], swap: { valuedBy: 'destination', authority: ['<img src=x onerror=alert(1)>'] } }] };
        const html = page().transactionsModalBody({ transactions: [], allTokens: true, tokenBreakdown: [scam], flows });
        expect(html).to.not.include('<img src=x');
    });
});

describe('the gathering hands each day its realizations', () => {
    it('carries them per token into the contribution', async () => {
        const realization = { amount: 5, initialConvertedValue: 1, convertedValue: 3, conversionRate: 0.6, profit: 2, loss: 0, position: { date: '2026-02-01' } };
        const { contributions } = await collectAllTokenDays({
            convertToCurrency: 'nok', periodStartDate: new Date('2026-03-01'), periodEndDate: new Date('2026-03-03'),
            tokens: [],
            deps: {
                calculateYearReportData: async () => ({ dailyBalances: { '2026-03-02': { stakingRewards: 0, received: 0, deposit: 0, withdrawal: 5, expense: 0, totalBalance: 0, totalChange: 0, profit: 2, loss: 0, realizations: [realization] } }, transactionsByDate: {} }),
                calculateProfitLoss: async (dailyBalances) => ({ dailyBalances }),
                getConvertedValuesForDay: async () => ({ stakingReward: 0, received: 0, deposit: 0, withdrawal: 3, expense: 0, conversionRate: 0.6 }),
                getFungibleTokenConvertedValuesForDay: async () => ({ stakingReward: 0, received: 0, deposit: 0, withdrawal: 0, expense: 0, conversionRate: 1 }),
                getDecimalConversionValue: () => 1e-24,
                getTokenSymbol: (t) => t,
                getEODPriceMap: async () => ({}),
                getReceivedAccounts: async () => ({}),
            },
        });
        const day = contributions.find(c => c.date === '2026-03-02');
        expect(day.realizations).to.deep.equal([realization]);
    });
});
