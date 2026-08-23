import './yearreport-print.component.js';
import { renderPeriodReportTable } from './yearreport-table-renderer.js';
import { ALL_TOKENS } from './all-tokens-daily.js';

// The table markup comes from the print component's template, which is the same
// row template the page uses. The gathering is stubbed: what is under test here
// is what the combined view puts on screen.
function table() {
    const el = document.createElement('year-report-print');
    return el.getRootNode().shadowRoot;
}

// The test browser's locale decides the separators, so the expected text is
// formatted the same way rather than written out.
const amount = (n) => Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const contribution = (over = {}) => ({
    token: '', symbol: 'NEAR', date: '2026-03-02', priced: true,
    stakingReward: 0, received: 0, deposit: 0, withdrawal: 0, expense: 0,
    profit: 0, loss: 0, totalBalance: 0, totalChange: 0,
    accountBalance: 0, accountChange: 0, stakingBalance: 0, stakingChange: 0,
    ...over,
});

async function render(collectResult, { convertToCurrency = 'nok', perRowFunction = async () => { } } = {}) {
    const shadowRoot = table();
    const result = await renderPeriodReportTable({
        shadowRoot,
        token: ALL_TOKENS,
        periodStartDate: new Date('2026-03-01'),
        periodEndDate: new Date('2026-03-05'),
        convertToCurrency,
        perRowFunction,
        collect: async () => ({
            contributions: [], transactionsByDate: {}, failed: [], neverPriced: [], flowsByDate: {},
            pricesUnavailable: {},
            ...collectResult,
        }),
    });
    return { shadowRoot, result, body: shadowRoot.querySelector('#dailybalancestable') };
}

const flows = (over = {}) => ({
    deposit: 0, withdrawal: 0, internalCount: 0, internalValue: 0, ambiguous: [], unpriced: [], ...over,
});

describe('every token on one row', () => {
    it('adds the balances up across tokens', async () => {
        const { body } = await render({
            contributions: [
                contribution({ symbol: 'NEAR', totalBalance: 5000 }),
                contribution({ symbol: 'BTC', token: 'btc.omft.near', totalBalance: 9000, deposit: 1 }),
            ],
        });
        const row = [...body.querySelectorAll('tr')].find(r => r.innerText.includes('2026-03-02'));
        expect(row.querySelector('.dailybalancerow_totalbalance').innerText).to.include('14');
    });

    // The per-token sums are gross: a swap arrives as a withdrawal in one token
    // and a deposit in another, so adding them up answers a question nobody
    // asked. The row shows what crossed the portfolio's edge.
    it('shows what crossed the edge, not the sum of every token movement', async () => {
        const { body, result } = await render({
            contributions: [
                contribution({ symbol: 'NEAR', withdrawal: 888 }),
                contribution({ symbol: 'USDC', token: 'usdc.near', deposit: 1140, withdrawal: 1140 }),
            ],
            flowsByDate: { '2026-03-02': flows({ deposit: 0, withdrawal: 250 }) },
        });
        const row = [...body.querySelectorAll('tr')].find(r => r.innerText.includes('2026-03-02'));
        expect(row.querySelector('.dailybalancerow_deposit').innerText).to.equal(amount(0));
        expect(row.querySelector('.dailybalancerow_withdrawal').innerText).to.equal(amount(250));
        expect(result.totalDeposit).to.equal(0);
        expect(result.totalWithdrawal).to.equal(250);
        // The gross is still there for anyone who wants it.
        expect(result.grossWithdrawal).to.equal(2028);
    });

    it('says the two columns mean something else here', async () => {
        const { shadowRoot } = await render({ contributions: [contribution({ deposit: 5 })] });
        expect(shadowRoot.querySelector('#header_deposit').innerText).to.equal('added in');
        expect(shadowRoot.querySelector('#header_withdrawal').innerText).to.equal('taken out');
    });

    // Repeating the currency on every cell is noise when every column is the
    // same currency; it earns its place only beside a token amount.
    it('names the currency once instead of on every amount', async () => {
        const { shadowRoot, body } = await render({
            contributions: [contribution({ totalBalance: 1000, deposit: 1234.5 })],
            flowsByDate: { '2026-03-02': flows({ deposit: 1234.5 }) },
        });
        expect(shadowRoot.querySelector('#reportcaption').innerText).to.include('NOK');
        const row = [...body.querySelectorAll('tr')].find(r => r.innerText.includes('2026-03-02'));
        expect(row.querySelector('.dailybalancerow_deposit').innerText).to.equal(amount(1234.5));
        expect(body.innerText).to.not.include('kr');
        expect(body.innerText).to.not.include('NOK');
    });

    // Units of NEAR and units of BTC cannot be added, and a column that sometimes
    // means one and sometimes the other is worse than no column.
    it('shows no token amounts', async () => {
        const { body } = await render({
            contributions: [contribution({ deposit: 1000, units: { deposit: 1e24 } })],
        });
        expect(body.innerHTML).to.not.include('token_amount');
    });

    // A day where every token sat still is still a day the report has data for.
    // Rendering all of them buries the ones that mean something; the first and
    // last day stay because that is where the balances are read off.
    it('leaves out days where nothing moved', async () => {
        const { body } = await render({
            contributions: [
                contribution({ date: '2026-03-02', deposit: 1000 }),
                contribution({ date: '2026-03-03' }),
            ],
        });
        const dates = [...body.querySelectorAll('.dailybalancerow_datetime')].map(td => td.innerText);
        expect(dates).to.include('2026-03-02');
        expect(dates).to.not.include('2026-03-03');
    });

    it('hands the day\'s tokens and its flows to the row so it can be taken apart', async () => {
        let seen;
        await render({
            contributions: [
                contribution({ symbol: 'NEAR', deposit: 1000 }),
                contribution({ symbol: 'BTC', token: 'btc.omft.near', withdrawal: 400 }),
            ],
            flowsByDate: { '2026-03-02': flows({ deposit: 12, internalCount: 3 }) },
        }, { perRowFunction: async (args) => { if (args.datestring === '2026-03-02') seen = args; } });
        expect(seen.allTokens).to.equal(true);
        expect(seen.tokenBreakdown.map(t => t.symbol).sort()).to.deep.equal(['BTC', 'NEAR']);
        expect(seen.flows.internalCount).to.equal(3);
    });

    // A day of pure swapping crosses the edge nowhere, and still happened.
    it('keeps a day whose movements were all internal', async () => {
        const { body } = await render({
            contributions: [contribution({ symbol: 'NEAR', withdrawal: 888 })],
            flowsByDate: { '2026-03-02': flows() },
        });
        expect(body.innerText).to.include('2026-03-02');
    });
});

describe('what it will not add up quietly', () => {
    it('asks for a currency instead of adding units of different tokens', async () => {
        const { body, result } = await render({ contributions: [contribution({ deposit: 1000 })] },
            { convertToCurrency: '' });
        expect(body.innerText).to.include('Pick a currency');
        expect(result.totalDeposit).to.equal(0);
    });

    // The day's total is genuinely short a leg. Showing it without saying so
    // would make an incomplete number look like a complete one.
    it('names the token that had no price that day', async () => {
        const { body } = await render({
            contributions: [
                contribution({ deposit: 1000 }),
                contribution({ symbol: 'MOON', token: 'aa-harvest-moon.near', priced: false }),
            ],
        });
        expect(body.innerText).to.include('no price');
        expect(body.innerText).to.include('MOON');
    });

    // Long enough to be a sentence, and sometimes a URL. What matters is which
    // tokens were left out, not reproducing their bait at full length.
    it('names tokens with no market once, trimmed, above the table', async () => {
        const { body } = await render({
            contributions: [contribution({ deposit: 1000 })],
            neverPriced: [
                { token: 'scam.near', symbol: 'Claim Near Airdrop at https://event.example' },
                { token: 'ariz.near', symbol: 'ARIZ' },
            ],
        });
        expect(body.innerText).to.include('No market in this period');
        expect(body.innerText).to.include('ARIZ');
        expect(body.innerText).to.not.include('https://event.example');
        expect(body.innerText).to.not.include('no price:');
    });

    // Refusing is what the flow panel does; a year of days cannot disappear over
    // one transaction, so it is counted and marked instead.
    it('marks a day whose transaction is not clearly a swap', async () => {
        const { body } = await render({
            contributions: [contribution({ deposit: 100 })],
            flowsByDate: { '2026-03-02': flows({ deposit: 100, ambiguous: [{ swapKey: 'x' }] }) },
        });
        expect(body.innerText).to.include('not clearly a swap');
    });

    it('says when a movement had no price, separately from a balance', async () => {
        const { body } = await render({
            contributions: [contribution({ deposit: 100 })],
            flowsByDate: { '2026-03-02': flows({ unpriced: ['MOON'] }) },
        });
        expect(body.innerText).to.include('flow not priced');
        expect(body.innerText).to.include('MOON');
    });

    it('says which token it could not read at all', async () => {
        const { body } = await render({
            contributions: [contribution({ deposit: 1000 })],
            failed: [{ token: 'broken.near', symbol: 'BRK', message: 'no history' }],
        });
        expect(body.innerText).to.include('BRK');
        expect(body.innerText).to.include('short those tokens');
    });
});

// A page that shows "Reading NEAR (1 of 46)" while a wallet dialog waits
// offscreen looks merely slow. Six minutes went by on a real machine before
// anyone knew what it was waiting for.
describe('when prices cannot be loaded at all', () => {
    it('says the session expired rather than blaming the tokens', async () => {
        const { body } = await render({
            contributions: [contribution({ deposit: 100 })],
            pricesUnavailable: { signature: true },
        });
        expect(body.innerText).to.include('session has expired');
        expect(body.innerText).to.include('Sign in again');
    });

    it('says the gateway did not answer, when that is what happened', async () => {
        const { body } = await render({
            contributions: [contribution({ deposit: 100 })],
            pricesUnavailable: { gateway: 'Ariz gateway did not answer /api/prices/history within 12 s' },
        });
        expect(body.innerText).to.include('did not answer');
    });

    it('says nothing when prices loaded', async () => {
        const { body } = await render({ contributions: [contribution({ deposit: 100 })] });
        expect(body.innerText).to.not.include('session has expired');
        expect(body.innerText).to.not.include('did not answer');
    });
});

// Fourteen columns do not fit, and the ones that scrolled off were the ones the
// view exists for.
describe('which columns the combined view shows', () => {
    const hiddenNow = (shadowRoot) => {
        const css = shadowRoot.querySelector('#hiddencolumns')?.textContent ?? '';
        return [...shadowRoot.querySelectorAll('table.dailybalances thead th')]
            .filter((th, i) => css.includes(`nth-child(${i + 1})`))
            .map(th => th.id.replace('header_', ''));
    };

    // Combined, the liquid/staked split is NEAR's split with every other token
    // heaped on one side, which is not a fact about anything.
    it('leaves out the balance split', async () => {
        const { shadowRoot } = await render({ contributions: [contribution({ deposit: 5 })] });
        expect(hiddenNow(shadowRoot)).to.include.members(
            ['accountbalance', 'accountchange', 'stakingbalance', 'stakingchange']);
    });

    it('keeps the flows and the value', async () => {
        const { shadowRoot } = await render({ contributions: [contribution({ deposit: 5 })] });
        const hidden = hiddenNow(shadowRoot);
        for (const kept of ['date', 'totalbalance', 'totalchange', 'reward', 'received', 'deposit', 'withdrawal']) {
            expect(hidden, kept).to.not.include(kept);
        }
    });

    // A swap crosses no edge and is still a disposal. The tax return wants the
    // total across every token, which is what this view is.
    it('keeps realized gain and loss', async () => {
        const { shadowRoot, result } = await render({
            contributions: [
                contribution({ symbol: 'NEAR', profit: 40 }),
                contribution({ symbol: 'BTC', token: 'btc.omft.near', loss: 15 }),
            ],
        });
        expect(hiddenNow(shadowRoot)).to.not.include('profit');
        expect(hiddenNow(shadowRoot)).to.not.include('loss');
        expect(result.totalProfit).to.equal(40);
        expect(result.totalLoss).to.equal(15);
    });

    it('adds realizations up across every token', async () => {
        const { shadowRoot } = await render({
            contributions: [
                contribution({ symbol: 'NEAR', profit: 40 }),
                contribution({ symbol: 'BTC', token: 'btc.omft.near', profit: 60 }),
            ],
        });
        expect(shadowRoot.querySelector('#totalprofit').innerText).to.equal(amount(100));
    });

    // A column that is zero for the whole period is noise; one with something in
    // it is information.
    it('drops an expenses column that stayed at zero', async () => {
        const { shadowRoot } = await render({ contributions: [contribution({ deposit: 5 })] });
        expect(hiddenNow(shadowRoot)).to.include('expenses');
    });

    it('keeps an expenses column that has something in it', async () => {
        const { shadowRoot } = await render({ contributions: [contribution({ expense: 12.5 })] });
        expect(hiddenNow(shadowRoot)).to.not.include('expenses');
    });

    // Counting columns works until someone inserts one, and then it hides a
    // different column with no sign that anything is wrong.
    it('finds a column by its name, not its position', async () => {
        const shadowRoot = table();
        const before = shadowRoot.querySelector('#header_accountbalance');
        const extra = document.createElement('th');
        extra.id = 'header_injected';
        before.parentElement.insertBefore(extra, before);
        await renderPeriodReportTable({
            shadowRoot, token: ALL_TOKENS,
            periodStartDate: new Date('2026-03-01'), periodEndDate: new Date('2026-03-05'),
            convertToCurrency: 'nok', perRowFunction: async () => { },
            collect: async () => ({ contributions: [contribution({ deposit: 5 })], transactionsByDate: {}, failed: [], neverPriced: [], flowsByDate: {}, pricesUnavailable: {} }),
        });
        const css = shadowRoot.querySelector('#hiddencolumns').textContent;
        const idx = [...shadowRoot.querySelectorAll('table.dailybalances thead th')]
            .findIndex(th => th.id === 'header_accountbalance') + 1;
        expect(css).to.include(`nth-child(${idx})`);
        expect(css).to.not.include(`nth-child(${idx - 1})`);
    });
});
