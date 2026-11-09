import '../yearreport/yearreport-print.component.js';
import { renderPeriodReportTable } from '../yearreport/yearreport-table-renderer.js';
import { ALL_TOKENS } from '../yearreport/all-tokens-daily.js';
import { setAccounts, writeTransactions, writeFungibleTokenTransactions, setHistoricalPriceData, getAllFungibleTokenEntries, writeAccountingRecords } from '../storage/domainobjectstore.js';
import { setSkipFetchingPrices, clearPriceHistoryCache } from '../pricedata/pricedata.js';
import { createDataSession } from './data-api.js';
import { computeBalanceCheck, createReports, MAX_REPORTS_PER_SESSION } from './reports.js';

// The agent answers questions about the Year report, so its figures have to be
// the page's figures. Both come from one function; this checks that holds for
// what the page actually draws, and that the figures are the right ones.

const ACCOUNT = 'reporter.near';
const USDC = 'usdc.fake.near';
const NEAR = 10n ** 24n;
const ns = (iso) => (BigInt(Date.parse(iso)) * 1_000_000n).toString();

before(async () => {
    const realFetch = window.fetch;
    window.fetch = async (url, init) => {
        if (String(url) === 'https://1click.chaindefuser.com/v0/tokens') {
            return new Response(JSON.stringify([
                { assetId: `nep141:${USDC}`, symbol: 'USDC', decimals: 6, blockchain: 'near' },
            ]), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return realFetch(url, init);
    };

    await setAccounts([ACCOUNT]);
    // 10 NEAR in on March 1st at 30, 4 NEAR out on June 1st at 40, and on
    // August 1st 2 NEAR swapped for 80 USDC. Newest first, as stored.
    const tx = (hash, iso, balance, from, to) => ({
        hash, block_timestamp: ns(iso), balance: String(balance), signer_id: from, receiver_id: to,
        predecessor_account_id: from, involved_account_id: from === ACCOUNT ? to : from, action_kind: 'TRANSFER',
    });
    await writeTransactions(ACCOUNT, [
        tx('SWAP1', '2025-08-01T12:00:00Z', 4n * NEAR, ACCOUNT, 'swapper.near'),
        tx('OUT1', '2025-06-01T12:00:00Z', 6n * NEAR, ACCOUNT, 'shop.near'),
        tx('IN1', '2025-03-01T12:00:00Z', 10n * NEAR, 'friend.near', ACCOUNT),
    ]);
    await writeFungibleTokenTransactions(ACCOUNT, [{
        transaction_hash: 'SWAP1', block_timestamp: ns('2025-08-01T12:00:05Z'), balance: '80000000',
        signer_id: ACCOUNT, receiver_id: USDC, involved_account_id: 'swapper.near', delta_amount: '80000000',
        ft: { contract_id: USDC, symbol: 'USDC', decimals: 6 },
    }]);

    const near = {};
    const usdc = {};
    for (let t = Date.parse('2025-01-01'); t <= Date.parse('2025-12-31'); t += 86400000) {
        const date = new Date(t).toJSON().slice(0, 10);
        near[date] = date < '2025-06-01' ? 30 : 40;
        usdc[date] = 1;
    }
    await setHistoricalPriceData('NEAR', 'nok', near);
    await setHistoricalPriceData('USDC', 'nok', usdc);
    for (const token of ['NEAR', 'USDC', USDC]) setSkipFetchingPrices(token, 'nok');
    clearPriceHistoryCache();
});

async function renderedOnPage() {
    const shadowRoot = document.createElement('year-report-print').getRootNode().shadowRoot;
    return renderPeriodReportTable({
        shadowRoot, token: ALL_TOKENS,
        periodStartDate: new Date(Date.UTC(2025, 0, 1)), periodEndDate: new Date(Date.UTC(2025, 11, 31)),
        convertToCurrency: 'nok', perRowFunction: async () => { },
        tokens: await getAllFungibleTokenEntries(),
    });
}

describe('the data agent\'s reports', () => {
    it('gives the totals the Year report page draws', async () => {
        const page = await renderedOnPage();
        const summary = await createDataSession().api.yearReport({ year: 2025, currency: 'NOK' });
        expect(summary).to.include({
            addedIn: page.totalDeposit, takenOut: page.totalWithdrawal,
            received: page.totalReceived, stakingRewards: page.totalStakingReward, expenses: page.totalExpense,
            realizedProfit: page.totalProfit, realizedLoss: page.totalLoss,
            grossDeposits: page.grossDeposit, grossWithdrawals: page.grossWithdrawal,
            balanceEndOfLastDay: page.outboundBalance.totalBalance,
        });
        // And those are the right figures, not merely the same ones.
        expect(summary.addedIn).to.be.closeTo(300, 1e-6);
        expect(summary.takenOut).to.be.closeTo(160, 1e-6);
        // The sale in June, and the swap: a disposal too, of 2 NEAR bought at 30
        // for 80 USDC at 1.
        expect(summary.realizedProfit).to.be.closeTo(4 * (40 - 30) + (80 - 2 * 30), 1e-6);
        expect(summary.grossWithdrawals).to.be.greaterThan(summary.takenOut);
        expect(summary.balanceEndOfLastDay).to.be.closeTo(4 * 40 + 80 * 1, 1e-6);
        expect(summary.leftOutAfterAnError).to.deep.equal([]);
    });

    it('lets the agent find the days and sales behind a total', async () => {
        const { api } = createDataSession();
        const out = await api.query({ dataset: 'yearReportDays', year: 2025, currency: 'nok', where: [['takenOut', '>', 0]] });
        expect(out.rows.map((row) => row.date)).to.deep.equal(['2025-06-01']);

        const swapDay = (await api.query({ dataset: 'yearReportDays', year: 2025, currency: 'nok', from: '2025-08-01', to: '2025-08-01' })).rows[0];
        expect(swapDay).to.include({ addedIn: 0, takenOut: 0, swaps: 1 });

        const sales = (await api.query({ dataset: 'yearReportRealizations', year: 2025, currency: 'nok', token: 'near' })).rows;
        const june = sales.find((sale) => sale.date === '2025-06-01');
        expect(june).to.include({ boughtOn: '2025-03-01', boughtAt: 30, soldAt: 40, soldIn: 'day price' });
        expect(june.amount).to.be.closeTo(4, 1e-9);
        expect(june.profit).to.be.closeTo(40, 1e-6);

        const perToken = await api.aggregate({
            dataset: 'yearReportTokens', year: 2025, currency: 'nok', groupBy: ['symbol'],
            metrics: { deposited: ['sum', 'deposit'], profit: ['sum', 'profit'] },
        });
        expect(perToken.groups.map((g) => g.symbol).sort()).to.deep.equal(['NEAR', 'USDC']);
    });

    it('gives the Portfolio page\'s figures and its holdings', async () => {
        const { api } = createDataSession();
        const summary = await api.portfolio({ currency: 'nok', fromDate: '2025-01-01' });
        const holdings = (await api.query({ dataset: 'portfolioHoldings', currency: 'nok', fromDate: '2025-01-01' })).rows;
        expect(summary.holdings).to.equal(holdings.length);
        const near = holdings.find((h) => h.symbol === 'NEAR');
        expect(near.amount).to.be.closeTo(4, 1e-9);
        expect(near.costBasisAtFromDate).to.equal(0);
        expect(summary.totalRealized).to.be.closeTo(4 * (40 - 30) + (80 - 2 * 30), 1e-6);
        expect(summary.changeSinceFromDate).to.be.an('object');
    });

    it('says what a report dataset needs, and refuses what is not a year or a currency', async () => {
        const { api } = createDataSession();
        const listed = await api.listDatasets();
        expect(listed.find((d) => d.dataset === 'yearReportDays').needs).to.deep.equal(['year', 'currency']);
        expect(listed.find((d) => d.dataset === 'records').needs).to.deep.equal(['account']);
        for (const bad of [{ year: 'abc', currency: 'nok' }, { year: 1999, currency: 'nok' }, { year: 2025, currency: '../x' }, { year: 2025 }]) {
            let error;
            try { await api.query({ dataset: 'yearReportDays', ...bad }); } catch (e) { error = e; }
            expect(error?.message, JSON.stringify(bad)).to.match(/year must be|currency must be/);
        }
    });

    it('checks balances only for the portfolio\'s own accounts with stored records', async () => {
        const { api } = createDataSession();
        let error;
        try { await api.balanceCheck({ account: 'stranger.near' }); } catch (e) { error = e; }
        expect(error.message).to.match(/not one of the portfolio's accounts/);
        try { await api.balanceCheck({ account: ACCOUNT }); } catch (e) { error = e; }
        expect(error.message).to.match(/no stored records to check: fetch its transactions first/);
    });

    it('sums a balance check up, and keeps every token for drilling down', async () => {
        await writeAccountingRecords(ACCOUNT, { metadata: { firstBlock: 1, lastBlock: 900, historyComplete: true }, records: [] });
        const check = async () => ({
            chainHeight: 1000,
            tokens: [
                { token: 'near', kind: 'near', stored: '5', now: '5', status: 'current' },
                { token: 'wrap.near', kind: 'fungible token', stored: '3', now: '1', status: 'behind', difference: '-2' },
                { token: 'usdc.near', kind: 'fungible token', stored: '9', now: '4', atLastStoredBlock: '4', status: 'wrong', difference: '-5' },
            ],
            heldButNotStored: [{ token: 'meta-pool.near', kind: 'fungible token', now: '287' }],
            holdingsListed: true, holdingsError: null,
        });
        const reports = createReports({ balances: (params) => computeBalanceCheck(params, { check }) });
        const { summary, rows } = await reports.balances({ account: ACCOUNT });
        expect(summary).to.include({ tokensChecked: 3, current: 1, blocksSinceStoredFile: 100, holdingsNotListed: null });
        expect(summary.wrong.map((t) => t.token)).to.deep.equal(['usdc.near']);
        expect(summary.behind.map((t) => t.token)).to.deep.equal(['wrap.near']);
        expect(summary.heldButNotStored.map((t) => t.token)).to.deep.equal(['meta-pool.near']);
        expect(rows.map((r) => r.status)).to.deep.equal(['current', 'behind', 'wrong', 'not stored']);
    });

    it('computes a report once a session, and only so many', async () => {
        let computed = 0;
        const reports = createReports({ year: async (params) => ({ summary: { ...params, n: ++computed } }) });
        await reports.year({ year: 2025, currency: 'nok' });
        await reports.year({ year: 2025, currency: 'NOK' });
        expect(computed).to.equal(1);

        let failing = 0;
        const flaky = createReports({ year: async () => { failing++; throw new Error('no'); } });
        let error;
        for (let i = 0; i <= MAX_REPORTS_PER_SESSION; i++) {
            try { await flaky.year({ year: 2025, currency: 'nok' }); } catch (e) { error = e; }
        }
        // A failure is retried, and every attempt counts.
        expect(failing).to.equal(MAX_REPORTS_PER_SESSION);
        expect(error.message).to.match(/the most it may/);
    });
});
