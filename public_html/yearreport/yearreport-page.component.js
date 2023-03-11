import { getEODPrice } from '../pricedata/pricedata.js';
import { calculateYearReportData, calculateProfitLoss } from './yearreportdata.js';
import { getCurrencyList } from '../pricedata/pricedata.js';
import html from './yearreport-page.component.html.js';

customElements.define('year-report-page',
    class extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this.readyPromise = this.loadHTML();
        }

        async loadHTML() {
            this.shadowRoot.innerHTML = html;
            document.querySelectorAll('link').forEach(lnk => this.shadowRoot.appendChild(lnk.cloneNode()));
            this.year = new Date().getFullYear();
            this.yearSelect = this.shadowRoot.querySelector('#yearselect');
            for (let year = this.year; year >= 2020; year--) {
                const yearOption = document.createElement('option');
                yearOption.value = year;
                yearOption.innerHTML = `${year}`;
                if (year === this.year) {
                    yearOption.selected = true;
                }
                this.yearSelect.appendChild(yearOption);
            }
            this.yearSelect.addEventListener('change', () => {
                this.year = parseInt(this.yearSelect.value);
                this.refreshView()
            });

            const currencyselect = this.shadowRoot.querySelector('#currencyselect');
            (await getCurrencyList()).forEach(currency => {
                const currencyoption = document.createElement('option');
                currencyoption.value = currency;
                currencyoption.text = currency.toUpperCase();
                currencyselect.appendChild(currencyoption);
            });
            
            const numDecimals = 2;
            currencyselect.addEventListener('change', () => this.updateView(currencyselect.value, numDecimals));
            this.updateView(currencyselect.value, numDecimals);
            return this.shadowRoot;
        }

        async updateView(convertToCurrency, numDecimals) {
            this.convertToCurrency = convertToCurrency;
            this.numDecimals = numDecimals;
            await this.refreshView();
        }

        async refreshView() {        
            const {dailyBalances, closedPositions, openPositions} = await calculateProfitLoss(await calculateYearReportData(), this.convertToCurrency)
            const yearReportData = dailyBalances;
            const yearReportTable = this.shadowRoot.querySelector('#dailybalancestable');
            
            while( yearReportTable.lastElementChild) {
                yearReportTable.removeChild(yearReportTable.lastElementChild);
            }

            const rowTemplate = this.shadowRoot.querySelector('#dailybalancerowtemplate');
            
            let currentDate = new Date().getFullYear() === this.year ? new Date(new Date(new Date().getTime() - 24 * 60 * 60 * 1000).toJSON().substring(0, 'yyyy-MM-dd'.length)) : new Date(`${this.year}-12-31`);
            const endDate = new Date(`${this.year}-01-01`);

            let totalStakingReward = 0;
            let totalDeposit = 0;
            let totalWithdrawal = 0;
            let totalProfit = 0;
            let totalLoss = 0;

            while (currentDate.getTime() >= endDate) {
                const datestring = currentDate.toJSON().substring(0, 'yyyy-MM-dd'.length);

                const row = rowTemplate.cloneNode(true).content;
                const rowdata = yearReportData[datestring];
                const conversionRate = this.convertToCurrency == 'near' ? 1 : await getEODPrice(this.convertToCurrency, datestring);
                
                const stakingReward = (conversionRate * (rowdata.stakingRewards / 1e+24));
                const deposit = (conversionRate * (rowdata.deposit / 1e+24));
                const withdrawal = (conversionRate * (rowdata.withdrawal / 1e+24));

                totalStakingReward += stakingReward;
                totalDeposit += deposit;
                totalWithdrawal += withdrawal;
                totalProfit += rowdata.profit ?? 0;
                totalLoss += rowdata.loss ?? 0;

                row.querySelector('.dailybalancerow_datetime').innerHTML = datestring;
                row.querySelector('.dailybalancerow_totalbalance').innerHTML = (conversionRate * (rowdata.totalBalance / 1e+24)).toFixed(this.numDecimals);
                row.querySelector('.dailybalancerow_accountbalance').innerHTML = (conversionRate * (Number(rowdata.accountBalance) / 1e+24)).toFixed(this.numDecimals);
                row.querySelector('.dailybalancerow_stakingbalance').innerHTML = (conversionRate * (rowdata.stakingBalance / 1e+24)).toFixed(this.numDecimals);
                row.querySelector('.dailybalancerow_change').innerHTML = (conversionRate * (rowdata.totalChange / 1e+24)).toFixed(this.numDecimals);
                row.querySelector('.dailybalancerow_accountchange').innerHTML = (conversionRate * (Number(rowdata.accountChange) / 1e+24)).toFixed(this.numDecimals);
                row.querySelector('.dailybalancerow_stakingchange').innerHTML = (conversionRate * (rowdata.stakingChange / 1e+24)).toFixed(this.numDecimals);
                row.querySelector('.dailybalancerow_stakingreward').innerHTML = stakingReward.toFixed(this.numDecimals);
                row.querySelector('.dailybalancerow_deposit').innerHTML = deposit.toFixed(this.numDecimals);
                row.querySelector('.dailybalancerow_withdrawal').innerHTML = withdrawal.toFixed(this.numDecimals);
                row.querySelector('.dailybalancerow_profit').innerHTML = rowdata.profit?.toFixed(this.numDecimals) ?? '';
                row.querySelector('.dailybalancerow_loss').innerHTML = rowdata.loss?.toFixed(this.numDecimals) ?? '';
                if (rowdata.realizations) {
                    const detailInfoElement = row.querySelector('.inforow td table tbody');
                    detailInfoElement.innerHTML = rowdata.realizations.map(r => `
                        <tr>
                            <td>${r.position.date}</td>
                            <td>${(r.position.initialAmount / 1e+24).toFixed(this.numDecimals)}</td>
                            <td>${r.position.conversionRate.toFixed(this.numDecimals)}</td>
                            <td>${(r.amount / 1e+24).toFixed(this.numDecimals)}</td>
                            <td>${r.conversionRate.toFixed(this.numDecimals)}</td>
                        </tr>
                    `).join('\n');
                } else {
                    row.querySelector('.inforow').remove();
                }
                yearReportTable.appendChild(row);

                currentDate = new Date(currentDate.getTime() - 24 * 60 * 60 * 1000);
            }

            this.shadowRoot.querySelector('#totalreward').innerHTML = totalStakingReward.toFixed(this.numDecimals);
            this.shadowRoot.querySelector('#totaldeposit').innerHTML = totalDeposit.toFixed(this.numDecimals);
            this.shadowRoot.querySelector('#totalwithdrawal').innerHTML = totalWithdrawal.toFixed(this.numDecimals);
            this.shadowRoot.querySelector('#totalprofit').innerHTML = totalProfit.toFixed(this.numDecimals);
            this.shadowRoot.querySelector('#totalloss').innerHTML = totalLoss.toFixed(this.numDecimals);
        }
    });