import { calculateYearReportData, calculateProfitLoss, getConvertedValuesForDay, getFungibleTokenConvertedValuesForDay, getDecimalConversionValue } from './yearreportdata.js';

const numDecimals = 2;

export function getNumberFormatter(currency) {
    const format = currency ? Intl.NumberFormat(navigator.language, { style: 'currency', currency: currency }).format :
        Intl.NumberFormat(navigator.language).format;
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

export async function renderYearReportTable({ shadowRoot, token, year, convertToCurrency, perRowFunction }) {
    const periodEndDate = new Date().getFullYear() === year ? new Date(new Date(new Date().getTime() - 24 * 60 * 60 * 1000).toJSON().substring(0, 'yyyy-MM-dd'.length)) : new Date(`${year}-12-31`);
    const periodStartDate = new Date(`${year}-01-01`);
    return await renderPeriodReportTable({ shadowRoot, token, periodEndDate, periodStartDate, convertToCurrency, perRowFunction });
}

export async function renderMonthPeriodReportTable({ shadowRoot, token, year, month, periodLengthMonths, convertToCurrency, perRowFunction }) {
    const { periodStartDate, periodEndDate } = calculatePeriodStartAndEndDate(year, month, periodLengthMonths);
    console.log(year, month, periodLengthMonths, periodStartDate, periodEndDate);
    return await renderPeriodReportTable({ shadowRoot, token, periodEndDate, periodStartDate, convertToCurrency, perRowFunction });
}

export async function renderPeriodReportTable({ shadowRoot, token, periodStartDate, periodEndDate, convertToCurrency, perRowFunction }) {
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
    let totalProfit = 0;
    let totalLoss = 0;

    let token_totalStakingReward = 0;
    let token_totalReceived = 0n;
    let token_totalDeposit = 0;
    let token_totalWithdrawal = 0;

    const decimalConversionValue = token ? getDecimalConversionValue(token) : Math.pow(10, -24);
    const tokenNumberFormatter = getNumberFormatter();
    const symbol = token === '' ? 'NEAR' : token;
    const formatTokenAmount = (amount) => {
        return `<span class="token_amount">${tokenNumberFormatter(amount * decimalConversionValue)} ${symbol}</span>`;
    };

    while (currentDate.getTime() >= periodStartDate) {
        const datestring = currentDate.toJSON().substring(0, 'yyyy-MM-dd'.length);

        const row = rowTemplate.cloneNode(true).content;
        const rowdata = yearReportData[datestring];

        const { stakingReward, received, deposit, withdrawal, conversionRate } = token ?
            await getFungibleTokenConvertedValuesForDay(rowdata, token, convertToCurrency, datestring) :
            await getConvertedValuesForDay(rowdata, convertToCurrency, datestring);

        totalStakingReward += stakingReward;
        totalDeposit += deposit;
        totalReceived += received;
        totalWithdrawal += withdrawal;
        totalProfit += rowdata.profit ?? 0;
        totalLoss += rowdata.loss ?? 0;

        token_totalStakingReward += rowdata.stakingRewards;
        token_totalReceived += rowdata.received;
        token_totalDeposit += rowdata.deposit;
        token_totalWithdrawal += rowdata.withdrawal;

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

        if (datestring.endsWith('12-31') || datestring.endsWith('01-01') ||
            rowdata.totalChange !== 0 ||
            received !== 0 ||
            deposit !== 0 ||
            withdrawal !== 0
        ) {
            yearReportTable.appendChild(row);
        }

        currentDate = new Date(currentDate.getTime() - 24 * 60 * 60 * 1000);
        shadowRoot.querySelector('#totalreward').innerHTML = `${formatNumber(totalStakingReward)} ${convertToCurrency ? `<br />${formatTokenAmount(token_totalStakingReward)}` : ''}`;
        shadowRoot.querySelector('#totalreceived').innerHTML = `${formatNumber(totalReceived)} ${convertToCurrency ? `<br />${formatTokenAmount(Number(token_totalReceived))}` : ''}`;
        shadowRoot.querySelector('#totaldeposit').innerHTML = `${formatNumber(totalDeposit)} ${convertToCurrency ? `<br />${formatTokenAmount(token_totalDeposit)}` : ''}`;
        shadowRoot.querySelector('#totalwithdrawal').innerHTML = `${formatNumber(totalWithdrawal)} ${convertToCurrency ? `<br />${formatTokenAmount(token_totalWithdrawal)}` : ''}`;
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
        totalProfit,
        totalLoss,
        outboundBalance: dailyBalances[outboundBalanceDate],
        inboundBalance: dailyBalances[inboundBalanceDate]
    }
}
