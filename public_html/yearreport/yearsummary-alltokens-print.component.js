import html from './yearsummary-alltokens-print.component.html.js';
import { getAllFungibleTokenSymbols } from '../storage/domainobjectstore.js';

customElements.define('yearsummary-alltokens-print',
    class extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this.shadowRoot.innerHTML = html;
            document.querySelectorAll('link').forEach(lnk => this.shadowRoot.appendChild(lnk.cloneNode()));

            const searchParams = new URLSearchParams(location.search);
            this.year = searchParams.get('year');
            this.currency = searchParams.get('currency');

            this.createReport();
        }

        async createReport() {
            const tokenYearReportsElement = this.shadowRoot.getElementById('tokenyearreports');
            const tokens = ['', ...await getAllFungibleTokenSymbols()];
            const summarytablebody = this.shadowRoot.getElementById('summarytablebody');
            const rowTemplate = this.shadowRoot.querySelector('#symmaryrowtemplate');

            const format = Intl.NumberFormat(navigator.language, {style: 'currency', currency: this.currency}).format;
            let totalBalance = 0;
            let totalEarnings = 0;
            let totalProfit = 0;
            let totalLoss = 0;

            for (const token of tokens) {
                const tokenreport = document.createElement('year-report-print');
                tokenreport.dataset.year = this.year;
                tokenreport.dataset.currency = this.currency;
                tokenreport.dataset.token = token;
                tokenreport.useDataset();

                const result = await tokenreport.createReport();
                
                if (!isNaN(result.outboundBalance.convertedTotalBalance) && (
                    result.totalReceived !== 0
                    || result.totalStakingReward !== 0
                    || result.totalDeposit !== 0
                    || result.totalWithdrawal !== 0
                )) {
                    tokenYearReportsElement.appendChild(tokenreport);
                    const row = rowTemplate.cloneNode(true).content;
                    const earnings = result.totalReceived + result.totalStakingReward;
                    row.querySelector('.summary_token').innerText = token === '' ? 'NEAR' : token;
                    row.querySelector('.summary_balance').innerText = format(result.outboundBalance.convertedTotalBalance);
                    row.querySelector('.summary_earnings').innerText = format(earnings);
                    row.querySelector('.summary_profit').innerText = format(result.totalProfit);
                    row.querySelector('.summary_loss').innerText = format(result.totalLoss);
                    summarytablebody.appendChild(row);

                    totalBalance += result.outboundBalance.convertedTotalBalance;
                    totalEarnings += earnings;
                    totalProfit += result.totalProfit;
                    totalLoss += result.totalLoss;

                    this.shadowRoot.getElementById('summary_total_balance').innerText = format(totalBalance);
                    this.shadowRoot.getElementById('summary_total_earnings').innerText = format(totalEarnings);
                    this.shadowRoot.getElementById('summary_total_profit').innerText = format(totalProfit);
                    this.shadowRoot.getElementById('summary_total_loss').innerText = format(totalLoss);
                }
            };
        }
    }
);
