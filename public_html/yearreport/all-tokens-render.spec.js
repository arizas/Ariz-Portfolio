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
        collect: async () => ({ contributions: [], transactionsByDate: {}, failed: [], ...collectResult }),
    });
    return { shadowRoot, result, body: shadowRoot.querySelector('#dailybalancestable') };
}

describe('every token on one row', () => {
    it('adds the day up across tokens', async () => {
        const { body, result } = await render({
            contributions: [
                contribution({ symbol: 'NEAR', deposit: 1000, totalBalance: 5000 }),
                contribution({ symbol: 'BTC', token: 'btc.omft.near', withdrawal: 400, totalBalance: 9000 }),
            ],
        });
        const row = [...body.querySelectorAll('tr')].find(r => r.innerText.includes('2026-03-02'));
        expect(row.querySelector('.dailybalancerow_deposit').innerText).to.include('1');
        expect(row.querySelector('.dailybalancerow_totalbalance').innerText).to.include('14');
        expect(result.totalDeposit).to.equal(1000);
        expect(result.totalWithdrawal).to.equal(400);
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

    it('hands the day\'s tokens to the row so it can be taken apart', async () => {
        let seen;
        await render({
            contributions: [
                contribution({ symbol: 'NEAR', deposit: 1000 }),
                contribution({ symbol: 'BTC', token: 'btc.omft.near', withdrawal: 400 }),
            ],
        }, { perRowFunction: async (args) => { if (args.datestring === '2026-03-02') seen = args; } });
        expect(seen.allTokens).to.equal(true);
        expect(seen.tokenBreakdown.map(t => t.symbol).sort()).to.deep.equal(['BTC', 'NEAR']);
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

    it('says which token it could not read at all', async () => {
        const { body } = await render({
            contributions: [contribution({ deposit: 1000 })],
            failed: [{ token: 'broken.near', symbol: 'BRK', message: 'no history' }],
        });
        expect(body.innerText).to.include('BRK');
        expect(body.innerText).to.include('short those tokens');
    });
});
