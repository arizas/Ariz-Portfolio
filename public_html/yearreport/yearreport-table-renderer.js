import { calculateYearReportData, calculateProfitLoss, getConvertedValuesForDay, getFungibleTokenConvertedValuesForDay, getDecimalConversionValue } from './yearreportdata.js';

const numDecimals = 2;

export async function renderYearReportTable({ shadowRoot, token, year, convertToCurrency, perRowFunction }) {
    let { dailyBalances, transactionsByDate } = await calculateYearReportData(token);
    dailyBalances = (await calculateProfitLoss(dailyBalances, convertToCurrency, token)).dailyBalances;

    const yearReportData = dailyBalances;
    const yearReportTable = shadowRoot.querySelector('#dailybalancestable');

    while (yearReportTable.lastElementChild) {
        yearReportTable.removeChild(yearReportTable.lastElementChild);
    }

    const rowTemplate = shadowRoot.querySelector('#dailybalancerowtemplate');

    let currentDate = new Date().getFullYear() === year ? new Date(new Date(new Date().getTime() - 24 * 60 * 60 * 1000).toJSON().substring(0, 'yyyy-MM-dd'.length)) : new Date(`${year}-12-31`);
    const endDate = new Date(`${year}-01-01`);

    let totalStakingReward = 0;
    let totalReceived = 0;
    let totalDeposit = 0;
    let totalWithdrawal = 0;
    let totalProfit = 0;
    let totalLoss = 0;

    const decimalConversionValue = token ? getDecimalConversionValue(token) : Math.pow(10, -24);

    while (currentDate.getTime() >= endDate) {
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

        rowdata.convertedTotalBalance = conversionRate * (rowdata.totalBalance * decimalConversionValue);
        rowdata.convertedAccountBalance = conversionRate * (Number(rowdata.accountBalance) * decimalConversionValue);
        rowdata.convertedStakingBalance = conversionRate * (rowdata.stakingBalance * decimalConversionValue);
        rowdata.convertedTotalChange = conversionRate * (rowdata.totalChange * decimalConversionValue);
        rowdata.convertedAccountChange = conversionRate * (Number(rowdata.accountChange) * decimalConversionValue);
        rowdata.convertedStakingChange = conversionRate * (rowdata.stakingChange * decimalConversionValue);

        row.querySelector('.dailybalancerow_datetime').innerHTML = datestring;
        row.querySelector('.dailybalancerow_totalbalance').innerHTML = rowdata.convertedTotalBalance.toFixed(numDecimals);
        row.querySelector('.dailybalancerow_accountbalance').innerHTML = rowdata.convertedAccountBalance.toFixed(numDecimals);
        row.querySelector('.dailybalancerow_stakingbalance').innerHTML = rowdata.convertedStakingBalance.toFixed(numDecimals);
        row.querySelector('.dailybalancerow_change').innerHTML = rowdata.convertedTotalChange.toFixed(numDecimals);
        row.querySelector('.dailybalancerow_accountchange').innerHTML = rowdata.convertedAccountChange.toFixed(numDecimals);
        row.querySelector('.dailybalancerow_stakingchange').innerHTML = rowdata.convertedStakingChange.toFixed(numDecimals);
        row.querySelector('.dailybalancerow_stakingreward').innerHTML = stakingReward.toFixed(numDecimals);
        row.querySelector('.dailybalancerow_received').innerHTML = received.toFixed(numDecimals);
        row.querySelector('.dailybalancerow_deposit').innerHTML = deposit.toFixed(numDecimals);
        row.querySelector('.dailybalancerow_withdrawal').innerHTML = withdrawal.toFixed(numDecimals);
        row.querySelector('.dailybalancerow_profit').innerHTML = rowdata.profit?.toFixed(numDecimals) ?? '';
        row.querySelector('.dailybalancerow_loss').innerHTML = rowdata.loss?.toFixed(numDecimals) ?? '';

        await perRowFunction({ transactionsByDate, datestring, row, decimalConversionValue, numDecimals });

        if (rowdata.realizations) {
            const detailInfoElement = row.querySelector('.inforow td table tbody');
            detailInfoElement.innerHTML = rowdata.realizations.map(r => `
                <tr>
                    <td>${r.position.date}</td>
                    <td>${(r.position.initialAmount * decimalConversionValue).toFixed(numDecimals)}</td>
                    <td>${r.position.conversionRate?.toFixed(numDecimals)}</td>
                    <td>${(r.amount * decimalConversionValue).toFixed(numDecimals)}</td>
                    <td>${r.conversionRate?.toFixed(numDecimals)}</td>
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
        shadowRoot.querySelector('#totalreward').innerHTML = totalStakingReward.toFixed(numDecimals);
        shadowRoot.querySelector('#totalreceived').innerHTML = totalReceived.toFixed(numDecimals);
        shadowRoot.querySelector('#totaldeposit').innerHTML = totalDeposit.toFixed(numDecimals);
        shadowRoot.querySelector('#totalwithdrawal').innerHTML = totalWithdrawal.toFixed(numDecimals);
        shadowRoot.querySelector('#totalprofit').innerHTML = totalProfit.toFixed(numDecimals);
        shadowRoot.querySelector('#totalloss').innerHTML = totalLoss.toFixed(numDecimals);
    }
    return {
        totalStakingReward,
        totalReceived,
        totalDeposit,
        totalWithdrawal,
        totalProfit,
        totalLoss,
        outboundBalance: dailyBalances[`${year}-12-31`],
        inboundBalance: dailyBalances[`${year}-01-01`]
    }
}
