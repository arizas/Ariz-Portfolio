import html from './yearreport-print.component.html.js';
import { calculateYearReportData, calculateProfitLoss, getConvertedValuesForDay, getFungibleTokenConvertedValuesForDay, getDecimalConversionValue } from './yearreportdata.js';

customElements.define('year-report-print',
    class extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: 'open' });

            const searchParams = new URLSearchParams(location.search);
            this.token = searchParams.get('token');
            this.year = searchParams.get('year');
            this.convertToCurrency = searchParams.get('currency');

            this.numDecimals = 2;
            if (this.token !== null) {
                console.log(this.token);
                this.createReport();
            }
        }

        useDataset() {
            this.year = this.dataset.year;
            this.convertToCurrency = this.dataset.currency;
            this.token = this.dataset.token;
        }

        async createReport() {
            this.shadowRoot.innerHTML = html;
            this.shadowRoot.getElementById('yearspan').innerText = this.year;
            this.shadowRoot.getElementById('tokenspan').innerText = this.token ? this.token : 'NEAR';
            this.shadowRoot.getElementById('currencyspan').innerText = this.convertToCurrency;
            document.querySelectorAll('link').forEach(lnk => this.shadowRoot.appendChild(lnk.cloneNode()));

            let { dailyBalances, transactionsByDate, accounts } = await calculateYearReportData(this.token);
            this.shadowRoot.getElementById('accountscolumn').innerHTML = accounts.join('<br />');
            dailyBalances = (await calculateProfitLoss(dailyBalances, this.convertToCurrency, this.token)).dailyBalances;

            const yearReportData = dailyBalances;
            const yearReportTable = this.shadowRoot.querySelector('#dailybalancestable');

            while (yearReportTable.lastElementChild) {
                yearReportTable.removeChild(yearReportTable.lastElementChild);
            }

            const rowTemplate = this.shadowRoot.querySelector('#dailybalancerowtemplate');

            let currentDate = new Date().getFullYear() === this.year ? new Date(new Date(new Date().getTime() - 24 * 60 * 60 * 1000).toJSON().substring(0, 'yyyy-MM-dd'.length)) : new Date(`${this.year}-12-31`);
            const endDate = new Date(`${this.year}-01-01`);

            let totalStakingReward = 0;
            let totalReceived = 0;
            let totalDeposit = 0;
            let totalWithdrawal = 0;
            let totalProfit = 0;
            let totalLoss = 0;

            const decimalConversionValue = this.token ? getDecimalConversionValue(this.token) : Math.pow(10, -24);
            const transactionstablebody = this.shadowRoot.querySelector('#transactionstablebody');

            while (currentDate.getTime() >= endDate) {
                const datestring = currentDate.toJSON().substring(0, 'yyyy-MM-dd'.length);

                const row = rowTemplate.cloneNode(true).content;
                const rowdata = yearReportData[datestring];

                const { stakingReward, received, deposit, withdrawal, conversionRate } = this.token ?
                    await getFungibleTokenConvertedValuesForDay(rowdata, this.token, this.convertToCurrency, datestring) :
                    await getConvertedValuesForDay(rowdata, this.convertToCurrency, datestring);

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
                row.querySelector('.dailybalancerow_totalbalance').innerHTML = rowdata.convertedTotalBalance.toFixed(this.numDecimals);
                row.querySelector('.dailybalancerow_accountbalance').innerHTML = rowdata.convertedAccountBalance.toFixed(this.numDecimals);
                row.querySelector('.dailybalancerow_stakingbalance').innerHTML = rowdata.convertedStakingBalance.toFixed(this.numDecimals);
                row.querySelector('.dailybalancerow_change').innerHTML = rowdata.convertedTotalChange.toFixed(this.numDecimals);
                row.querySelector('.dailybalancerow_accountchange').innerHTML = rowdata.convertedAccountChange.toFixed(this.numDecimals);
                row.querySelector('.dailybalancerow_stakingchange').innerHTML = rowdata.convertedStakingChange.toFixed(this.numDecimals);
                row.querySelector('.dailybalancerow_stakingreward').innerHTML = stakingReward.toFixed(this.numDecimals);
                row.querySelector('.dailybalancerow_received').innerHTML = received.toFixed(this.numDecimals);
                row.querySelector('.dailybalancerow_deposit').innerHTML = deposit.toFixed(this.numDecimals);
                row.querySelector('.dailybalancerow_withdrawal').innerHTML = withdrawal.toFixed(this.numDecimals);
                row.querySelector('.dailybalancerow_profit').innerHTML = rowdata.profit?.toFixed(this.numDecimals) ?? '';
                row.querySelector('.dailybalancerow_loss').innerHTML = rowdata.loss?.toFixed(this.numDecimals) ?? '';

                if (transactionsByDate[datestring]) {
                    const transactions = transactionsByDate[datestring];
                    for (let tx of transactions) {
                        const transactionRow = document.createElement('tr');
                        transactionRow.innerHTML = `<td>
${datestring}
</td>
${this.token ? `
<td>${tx.involved_account_id}</td>
<td>${tx.affected_account_id}</td>
<td>${tx.cause}</td>

<td class="numeric">${(tx.delta_amount * decimalConversionValue).toFixed(this.numDecimals)}</td>`
        :
        `<td>${tx.signer_id}</td>
    <td>${tx.receiver_id}</td>
    <td>${tx.action_kind}</td>
    <td class="numeric">${tx.visibleChangedBalance.toFixed(this.numDecimals)}</td>`}
<td><a class="btn btn-light" target="_blank" href="https://nearblocks.io/txns/${tx.hash}">&#128194;</a>
</td>`;
                        transactionstablebody.appendChild(transactionRow);
                    }
                }

                if (rowdata.realizations) {
                    const detailInfoElement = row.querySelector('.inforow td table tbody');
                    detailInfoElement.innerHTML = rowdata.realizations.map(r => `
                        <tr>
                            <td>${r.position.date}</td>
                            <td>${(r.position.initialAmount * decimalConversionValue).toFixed(this.numDecimals)}</td>
                            <td>${r.position.conversionRate?.toFixed(this.numDecimals)}</td>
                            <td>${(r.amount * decimalConversionValue).toFixed(this.numDecimals)}</td>
                            <td>${r.conversionRate?.toFixed(this.numDecimals)}</td>
                        </tr>
                    `).join('\n');
                } else {
                    row.querySelector('.inforow').remove();
                }

                if (datestring.endsWith('12-31') || datestring.endsWith('01-01') || rowdata.totalChange !== 0) {
                    yearReportTable.appendChild(row);
                }

                currentDate = new Date(currentDate.getTime() - 24 * 60 * 60 * 1000);
                this.shadowRoot.querySelector('#totalreward').innerHTML = totalStakingReward.toFixed(this.numDecimals);
                this.shadowRoot.querySelector('#totalreceived').innerHTML = totalReceived.toFixed(this.numDecimals);
                this.shadowRoot.querySelector('#totaldeposit').innerHTML = totalDeposit.toFixed(this.numDecimals);
                this.shadowRoot.querySelector('#totalwithdrawal').innerHTML = totalWithdrawal.toFixed(this.numDecimals);
                this.shadowRoot.querySelector('#totalprofit').innerHTML = totalProfit.toFixed(this.numDecimals);
                this.shadowRoot.querySelector('#totalloss').innerHTML = totalLoss.toFixed(this.numDecimals);
            }
            return {
                totalStakingReward,
                totalReceived,
                totalDeposit,
                totalWithdrawal,
                totalProfit,
                totalLoss,
                outboundBalance: dailyBalances[`${this.year}-12-31`],
                inboundBalance: dailyBalances[`${this.year}-01-01`]
            }
        }
    }
);
