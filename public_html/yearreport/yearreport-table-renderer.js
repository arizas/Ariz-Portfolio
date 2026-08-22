import { calculateYearReportData, calculateProfitLoss, getConvertedValuesForDay, getFungibleTokenConvertedValuesForDay, getDecimalConversionValue, getTokenSymbol } from './yearreportdata.js';
import { browserLocale } from '../util/locale.js';
import { ALL_TOKENS, combineDailyRows } from './all-tokens-daily.js';
import { collectAllTokenDays } from './all-tokens-collect.js';

const numDecimals = 2;

/**
 * Amounts with no currency on each one. When every column is the same currency,
 * repeating it on every cell is noise — it earns its place only beside a token
 * amount, where there are two units on the row to tell apart. Two decimals
 * always, so the columns line up.
 */
export function getAmountFormatter() {
    const format = Intl.NumberFormat(browserLocale(), {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format;
    return (number) => number !== null && number !== undefined && !isNaN(number) ? format(number) : '';
}

export function getNumberFormatter(currency) {
    const format = currency ? Intl.NumberFormat(browserLocale(), { style: 'currency', currency: currency }).format :
        Intl.NumberFormat(browserLocale()).format;
    return (number) => number !== null && number !== undefined && !isNaN(number) ? format(number) : '';;
}

export function hideProfitLossIfNoConvertToCurrency(convertToCurrency, shadowRoot) {
    if (!convertToCurrency) {
        const style = document.createElement('style');
        style.innerHTML = `
.profit, .loss, .summary_profit, .summary_loss, .dailybalancerow_profit, .dailybalancerow_loss, #summarytablefooter {
    display: none;
}
        `;
        shadowRoot.appendChild(style);
    }
}

export function calculatePeriodStartAndEndDate(year, month, periodLengthMonths) {
    const periodStartDate = new Date(Date.UTC(year, month, 1));
    let periodEndDate = new Date(Date.UTC(year, month, 1));
    periodEndDate.setMonth(periodEndDate.getMonth() + Number(periodLengthMonths));
    periodEndDate.setDate(periodEndDate.getDate() - 1);

    const maxPeriodEndDate = new Date(new Date(new Date().getTime() - 24 * 60 * 60 * 1000).toJSON().substring(0, 'yyyy-MM-dd'.length));

    if (periodEndDate > maxPeriodEndDate) {
        periodEndDate = maxPeriodEndDate;
    }

    return { periodStartDate, periodEndDate };
}

export async function renderYearReportTable({ shadowRoot, token, year, convertToCurrency, perRowFunction, tokens, onProgress }) {
    const periodEndDate = new Date().getFullYear() === year ? new Date(new Date(new Date().getTime() - 24 * 60 * 60 * 1000).toJSON().substring(0, 'yyyy-MM-dd'.length)) : new Date(`${year}-12-31`);
    const periodStartDate = new Date(`${year}-01-01`);
    return await renderPeriodReportTable({ shadowRoot, token, periodEndDate, periodStartDate, convertToCurrency, perRowFunction, tokens, onProgress });
}

export async function renderMonthPeriodReportTable({ shadowRoot, token, year, month, periodLengthMonths, convertToCurrency, perRowFunction, tokens, onProgress }) {
    const { periodStartDate, periodEndDate } = calculatePeriodStartAndEndDate(year, month, periodLengthMonths);
    console.log(year, month, periodLengthMonths, periodStartDate, periodEndDate);
    return await renderPeriodReportTable({ shadowRoot, token, periodEndDate, periodStartDate, convertToCurrency, perRowFunction, tokens, onProgress });
}

export async function renderPeriodReportTable({ shadowRoot, token, periodStartDate, periodEndDate, convertToCurrency, perRowFunction, tokens, onProgress, collect }) {
    if (token === ALL_TOKENS) {
        return await renderAllTokensPeriodTable({
            shadowRoot, periodStartDate, periodEndDate, convertToCurrency, perRowFunction, tokens, onProgress, collect,
        });
    }
    // Switching back from the combined view: those columns mean what they say
    // again, and there is no single currency to caption.
    setHeader(shadowRoot, '#header_deposit', 'deposit');
    setHeader(shadowRoot, '#header_withdrawal', 'withdrawals');
    setCaption(shadowRoot, '');

    let currentDate = periodEndDate;

    let { dailyBalances, transactionsByDate } = await calculateYearReportData(token);
    dailyBalances = (await calculateProfitLoss(dailyBalances, convertToCurrency, token)).dailyBalances;

    const yearReportData = dailyBalances;
    const yearReportTable = shadowRoot.querySelector('#dailybalancestable');

    while (yearReportTable.lastElementChild) {
        yearReportTable.removeChild(yearReportTable.lastElementChild);
    }

    const rowTemplate = shadowRoot.querySelector('#dailybalancerowtemplate');

    const formatNumber = getNumberFormatter(convertToCurrency);

    let totalStakingReward = 0;
    let totalReceived = 0;
    let totalDeposit = 0;
    let totalWithdrawal = 0;
    let totalExpense = 0;
    let totalProfit = 0;
    let totalLoss = 0;

    let token_totalStakingReward = 0;
    let token_totalReceived = 0n;
    let token_totalDeposit = 0;
    let token_totalWithdrawal = 0;
    let token_totalExpense = 0n;

    const decimalConversionValue = token ? getDecimalConversionValue(token) : Math.pow(10, -24);
    const tokenNumberFormatter = getNumberFormatter();
    const symbol = token === '' ? 'NEAR' : (getTokenSymbol(token) || token);
    const formatTokenAmount = (amount) => {
        return `<span class="token_amount">${tokenNumberFormatter(amount * decimalConversionValue)} ${symbol}</span>`;
    };

    while (currentDate.getTime() >= periodStartDate) {
        const datestring = currentDate.toJSON().substring(0, 'yyyy-MM-dd'.length);

        const row = rowTemplate.cloneNode(true).content;
        const rowdata = yearReportData[datestring];

        const { stakingReward, received, deposit, withdrawal, expense, conversionRate } = token ?
            await getFungibleTokenConvertedValuesForDay(rowdata, token, convertToCurrency, datestring) :
            await getConvertedValuesForDay(rowdata, convertToCurrency, datestring);

        totalStakingReward += stakingReward;
        totalDeposit += deposit;
        totalReceived += received;
        totalWithdrawal += withdrawal;
        totalExpense += expense;
        totalProfit += rowdata.profit ?? 0;
        totalLoss += rowdata.loss ?? 0;

        token_totalStakingReward += rowdata.stakingRewards;
        token_totalReceived += rowdata.received;
        token_totalDeposit += rowdata.deposit;
        token_totalWithdrawal += rowdata.withdrawal;
        token_totalExpense += rowdata.expense;

        rowdata.convertedTotalBalance = conversionRate * (rowdata.totalBalance * decimalConversionValue);
        rowdata.convertedAccountBalance = conversionRate * (Number(rowdata.accountBalance) * decimalConversionValue);
        rowdata.convertedStakingBalance = conversionRate * (rowdata.stakingBalance * decimalConversionValue);
        rowdata.convertedTotalChange = conversionRate * (rowdata.totalChange * decimalConversionValue);
        rowdata.convertedAccountChange = conversionRate * (Number(rowdata.accountChange) * decimalConversionValue);
        rowdata.convertedStakingChange = conversionRate * (rowdata.stakingChange * decimalConversionValue);

        row.querySelector('.dailybalancerow_datetime').innerText = datestring;
        row.querySelector('.dailybalancerow_totalbalance').innerHTML = `${formatNumber(rowdata.convertedTotalBalance)} ${convertToCurrency ? `<br />${formatTokenAmount(rowdata.totalBalance)}` : ''}`;
        row.querySelector('.dailybalancerow_accountbalance').innerHTML = `${formatNumber(rowdata.convertedAccountBalance)} ${convertToCurrency ? `<br />${formatTokenAmount(Number(rowdata.accountBalance))}` : ''}`;
        row.querySelector('.dailybalancerow_stakingbalance').innerHTML = `${formatNumber(rowdata.convertedStakingBalance)} ${convertToCurrency ? `<br />${formatTokenAmount(rowdata.stakingBalance)}` : ''}`;
        row.querySelector('.dailybalancerow_change').innerHTML = `${formatNumber(rowdata.convertedTotalChange)} ${convertToCurrency ? `<br />${formatTokenAmount(rowdata.totalChange)}` : ''}`;
        row.querySelector('.dailybalancerow_accountchange').innerHTML = `${formatNumber(rowdata.convertedAccountChange)} ${convertToCurrency ? `<br />${formatTokenAmount(Number(rowdata.accountChange))}` : ''}`;
        row.querySelector('.dailybalancerow_stakingchange').innerHTML = `${formatNumber(rowdata.convertedStakingChange)} ${convertToCurrency ? `<br />${formatTokenAmount(rowdata.stakingChange)}` : ''}`;
        row.querySelector('.dailybalancerow_stakingreward').innerHTML = `${formatNumber(stakingReward)} ${convertToCurrency ? `<br />${formatTokenAmount(rowdata.stakingRewards)}` : ''}`;
        row.querySelector('.dailybalancerow_received').innerHTML = `${formatNumber(received)} ${convertToCurrency ? `<br />${formatTokenAmount(Number(rowdata.received))}` : ''}`;
        row.querySelector('.dailybalancerow_deposit').innerHTML = `${formatNumber(deposit)} ${convertToCurrency ? `<br />${formatTokenAmount(rowdata.deposit)}` : ''}`;
        row.querySelector('.dailybalancerow_withdrawal').innerHTML = `${formatNumber(withdrawal)} ${convertToCurrency ? `<br />${formatTokenAmount(rowdata.withdrawal)}` : ''}`;
        row.querySelector('.dailybalancerow_expense').innerHTML = `${formatNumber(expense)} ${convertToCurrency ? `<br />${formatTokenAmount(Number(rowdata.expense))}` : ''}`;
        if (convertToCurrency) {
            row.querySelector('.dailybalancerow_profit').innerText = formatNumber(rowdata.profit) ?? '';
            row.querySelector('.dailybalancerow_loss').innerText = formatNumber(rowdata.loss) ?? '';
        }

        await perRowFunction({ transactionsByDate, datestring, row, decimalConversionValue, numDecimals });

        if (rowdata.realizations) {
            const detailInfoElement = row.querySelector('.inforow td table tbody');
            detailInfoElement.innerHTML = rowdata.realizations.map(r => `
                <tr>
                    <td>${r.position.date}</td>
                    <td>${formatTokenAmount(r.position.initialAmount)}</td>
                    <td>${formatNumber(r.position.conversionRate)}</td>
                    <td>${formatTokenAmount(r.amount)}</td>
                    <td>${formatNumber(r.conversionRate)}</td>
                </tr>
            `).join('\n');
        } else {
            row.querySelector('.inforow').remove();
        }

        const periodStartDateString = periodStartDate.toJSON().substring(0, 'yyyy-MM-dd'.length);
        const periodEndDateString = periodEndDate.toJSON().substring(0, 'yyyy-MM-dd'.length);
        
        if (datestring.endsWith('12-31') || datestring.endsWith('01-01') ||
            datestring === periodStartDateString ||
            datestring === periodEndDateString ||
            rowdata.totalChange !== 0 ||
            received !== 0 ||
            deposit !== 0 ||
            withdrawal !== 0 ||
            expense !== 0
        ) {
            yearReportTable.appendChild(row);
        }

        currentDate = new Date(currentDate.getTime() - 24 * 60 * 60 * 1000);
        shadowRoot.querySelector('#totalreward').innerHTML = `${formatNumber(totalStakingReward)} ${convertToCurrency ? `<br />${formatTokenAmount(token_totalStakingReward)}` : ''}`;
        shadowRoot.querySelector('#totalreceived').innerHTML = `${formatNumber(totalReceived)} ${convertToCurrency ? `<br />${formatTokenAmount(Number(token_totalReceived))}` : ''}`;
        shadowRoot.querySelector('#totaldeposit').innerHTML = `${formatNumber(totalDeposit)} ${convertToCurrency ? `<br />${formatTokenAmount(token_totalDeposit)}` : ''}`;
        shadowRoot.querySelector('#totalwithdrawal').innerHTML = `${formatNumber(totalWithdrawal)} ${convertToCurrency ? `<br />${formatTokenAmount(token_totalWithdrawal)}` : ''}`;
        shadowRoot.querySelector('#totalexpense').innerHTML = `${formatNumber(totalExpense)} ${convertToCurrency ? `<br />${formatTokenAmount(Number(token_totalExpense))}` : ''}`;
        if (convertToCurrency) {
            shadowRoot.querySelector('#totalprofit').innerText = formatNumber(totalProfit);
            shadowRoot.querySelector('#totalloss').innerText = formatNumber(totalLoss);
        }
    }

    const outboundBalanceDate = new Date(periodEndDate.getTime()).toJSON().substring(0, 'yyyy-MM-dd'.length);
    const inboundBalanceDate = new Date(periodStartDate.getTime()).toJSON().substring(0, 'yyyy-MM-dd'.length);

    return {
        totalStakingReward,
        totalReceived,
        totalDeposit,
        totalWithdrawal,
        totalExpense,
        totalProfit,
        totalLoss,
        outboundBalance: dailyBalances[outboundBalanceDate],
        inboundBalance: dailyBalances[inboundBalanceDate]
    }
}

/**
 * Every token on one row per day, in the chosen currency.
 *
 * The per-token table is the right shape for cost basis and the wrong shape for
 * "what did I actually put in on the 14th?" — that answer is spread over as many
 * tables as there are tokens. Here it is one row, with the tokens that made it
 * up behind it.
 *
 * Token amounts are gone from this view. Units of different tokens cannot be
 * added, and a column that sometimes means NEAR and sometimes means BTC is worse
 * than no column.
 */
export async function renderAllTokensPeriodTable({
    shadowRoot, periodStartDate, periodEndDate, convertToCurrency, perRowFunction, tokens,
    onProgress = () => { }, collect = collectAllTokenDays,
}) {
    const yearReportTable = shadowRoot.querySelector('#dailybalancestable');
    while (yearReportTable.lastElementChild) {
        yearReportTable.removeChild(yearReportTable.lastElementChild);
    }

    const empty = {
        totalStakingReward: 0, totalReceived: 0, totalDeposit: 0, totalWithdrawal: 0,
        totalExpense: 0, totalProfit: 0, totalLoss: 0,
        outboundBalance: undefined, inboundBalance: undefined,
    };

    // Say why rather than render something meaningless: without a currency there
    // is nothing the tokens can be added in.
    if (!convertToCurrency) {
        yearReportTable.appendChild(messageRow(
            'Pick a currency to see every token together — token amounts cannot be added across tokens.'));
        return empty;
    }

    const { contributions, transactionsByDate, failed, neverPriced = [], flowsByDate = {} } = await collect({
        tokens, periodStartDate, periodEndDate, convertToCurrency, onProgress,
    });
    const { rows, totals } = combineDailyRows(contributions);

    const formatNumber = getAmountFormatter();
    // The flow columns answer a different question here than they do per token,
    // so they say so. Per token, "deposit" is every unit that arrived. Combined,
    // it is only what came from outside the portfolio.
    setHeader(shadowRoot, '#header_deposit', 'added in');
    setHeader(shadowRoot, '#header_withdrawal', 'taken out');
    setCaption(shadowRoot, `All amounts in ${convertToCurrency.toUpperCase()}. "Added in" and "taken out" are what crossed the portfolio's edge — a swap moves value between your own tokens and is not counted as either. Open a day to see every token's own deposits and withdrawals.`);
    const periodStartDateString = periodStartDate.toJSON().substring(0, 'yyyy-MM-dd'.length);
    const periodEndDateString = periodEndDate.toJSON().substring(0, 'yyyy-MM-dd'.length);
    const rowTemplate = shadowRoot.querySelector('#dailybalancerowtemplate');

    if (failed.length) {
        yearReportTable.appendChild(messageRow(
            `Left out: ${failed.map(f => `${f.symbol} (${f.message})`).join(', ')}. The totals below are short those tokens.`));
    }
    if (neverPriced.length) {
        yearReportTable.appendChild(messageRow(
            `No market in this period, so not counted: ${nameList(neverPriced.map(t => t.symbol))}.`));
    }
    if (totals.unvalued.length) {
        yearReportTable.appendChild(messageRow(
            `Held on some days with no price that day, so the balance columns are short them: ${nameList(totals.unvalued)}. Days where one of them actually moved are marked on the row.`));
    }

    const flowTotals = { deposit: 0, withdrawal: 0 };
    for (const rowdata of rows) {
        const datestring = rowdata.date;
        const flows = flowsByDate[datestring] ?? EMPTY_FLOWS;
        flowTotals.deposit += flows.deposit;
        flowTotals.withdrawal += flows.withdrawal;
        const row = rowTemplate.cloneNode(true).content;

        row.querySelector('.dailybalancerow_datetime').innerText = datestring;
        row.querySelector('.dailybalancerow_totalbalance').innerText = formatNumber(rowdata.totalBalance);
        row.querySelector('.dailybalancerow_change').innerText = formatNumber(rowdata.totalChange);
        row.querySelector('.dailybalancerow_accountbalance').innerText = formatNumber(rowdata.accountBalance);
        row.querySelector('.dailybalancerow_accountchange').innerText = formatNumber(rowdata.accountChange);
        row.querySelector('.dailybalancerow_stakingbalance').innerText = formatNumber(rowdata.stakingBalance);
        row.querySelector('.dailybalancerow_stakingchange').innerText = formatNumber(rowdata.stakingChange);
        row.querySelector('.dailybalancerow_stakingreward').innerText = formatNumber(rowdata.stakingReward);
        row.querySelector('.dailybalancerow_received').innerText = formatNumber(rowdata.received);
        row.querySelector('.dailybalancerow_deposit').innerText = formatNumber(flows.deposit);
        row.querySelector('.dailybalancerow_withdrawal').innerText = formatNumber(flows.withdrawal);
        row.querySelector('.dailybalancerow_expense').innerText = formatNumber(rowdata.expense);
        row.querySelector('.dailybalancerow_profit').innerText = formatNumber(rowdata.profit);
        row.querySelector('.dailybalancerow_loss').innerText = formatNumber(rowdata.loss);

        // Built as nodes rather than markup: a token symbol here can be an
        // attacker-chosen string, and some of them are literally URLs.
        const dateCell = row.querySelector('.dailybalancerow_datetime');
        const noteOnDate = (text, title) => {
            const note = document.createElement('span');
            note.className = 'text-warning small';
            note.title = title;
            note.innerText = text;
            dateCell.appendChild(document.createElement('br'));
            dateCell.appendChild(note);
        };
        if (rowdata.unpriced.length) {
            noteOnDate(`no price: ${nameList(rowdata.unpriced)}`,
                "No price that day, so this token is missing from the day's totals");
        }
        if (flows.unpriced.length) {
            noteOnDate(`flow not priced: ${nameList(flows.unpriced)}`,
                'A movement on this day had no price, so what crossed the edge is understated');
        }
        // Counted as crossing the edge rather than dropped — but a transaction
        // whose two sides do not match may be a swap and a real transfer sharing
        // one hash, and then this day's figures are too high.
        if (flows.ambiguous.length) {
            noteOnDate(`${flows.ambiguous.length} transaction${flows.ambiguous.length === 1 ? '' : 's'} not clearly a swap`,
                'Both sides moved but the values do not match; counted as added and taken out, worth checking');
        }

        await perRowFunction({
            transactionsByDate, datestring, row, decimalConversionValue: 1, numDecimals,
            allTokens: true, tokenBreakdown: rowdata.tokens, flows,
        });

        // The detail row belongs to per-token realizations, which do not survive
        // being added together. The breakdown lives behind the transactions button.
        row.querySelector('.inforow')?.remove();

        if (rowdata.tokens.length || rowdata.unpriced.length || rowdata.unvalued.length ||
            datestring === periodStartDateString || datestring === periodEndDateString ||
            datestring.endsWith('12-31') || datestring.endsWith('01-01')) {
            yearReportTable.appendChild(row);
        }
    }

    shadowRoot.querySelector('#totalreward').innerText = formatNumber(totals.stakingReward);
    shadowRoot.querySelector('#totalreceived').innerText = formatNumber(totals.received);
    shadowRoot.querySelector('#totaldeposit').innerText = formatNumber(flowTotals.deposit);
    shadowRoot.querySelector('#totalwithdrawal').innerText = formatNumber(flowTotals.withdrawal);
    shadowRoot.querySelector('#totalexpense').innerText = formatNumber(totals.expense);
    shadowRoot.querySelector('#totalprofit').innerText = formatNumber(totals.profit);
    shadowRoot.querySelector('#totalloss').innerText = formatNumber(totals.loss);

    return {
        totalStakingReward: totals.stakingReward,
        totalReceived: totals.received,
        totalDeposit: flowTotals.deposit,
        totalWithdrawal: flowTotals.withdrawal,
        grossDeposit: totals.deposit,
        grossWithdrawal: totals.withdrawal,
        totalExpense: totals.expense,
        totalProfit: totals.profit,
        totalLoss: totals.loss,
        outboundBalance: rows.find(r => r.date === periodEndDateString),
        inboundBalance: rows.find(r => r.date === periodStartDateString),
        unpriced: totals.unpriced,
        unvalued: totals.unvalued,
        failed,
        neverPriced,
    };
}

// An airdropped token can carry a whole sentence, or a URL, as its symbol. The
// line is about which tokens were left out, not about reproducing their bait.
function nameList(symbols, limit = 6) {
    const shown = symbols.slice(0, limit).map(s => s.length > 14 ? `${s.substring(0, 14)}\u2026` : s);
    const rest = symbols.length - shown.length;
    return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ');
}

const EMPTY_FLOWS = Object.freeze({
    deposit: 0, withdrawal: 0, internalCount: 0, internalValue: 0, ambiguous: [], unpriced: [],
});

function setHeader(shadowRoot, selector, text) {
    const cell = shadowRoot.querySelector(selector);
    if (cell) cell.innerText = text;
}

function setCaption(shadowRoot, text) {
    const el = shadowRoot.querySelector('#reportcaption');
    if (el) el.innerText = text ?? '';
}

function messageRow(text) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 15;
    td.className = 'text-muted';
    td.innerText = text;
    tr.appendChild(td);
    return tr;
}
