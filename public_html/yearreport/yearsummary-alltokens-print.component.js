import html from './yearsummary-alltokens-print.component.html.js';
import { getAccounts, getAllFungibleTokenEntries, getIgnoredFungibleTokens } from '../storage/domainobjectstore.js';
import { getNumberFormatter, hideProfitLossIfNoConvertToCurrency } from './yearreport-table-renderer.js';
import { getDecimalConversionValue, getTokenSymbol } from './yearreportdata.js';

customElements.define('yearsummary-alltokens-print',
    class extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this.shadowRoot.innerHTML = html;
            document.querySelectorAll('link').forEach(lnk => this.shadowRoot.appendChild(lnk.cloneNode()));

            const searchParams = new URLSearchParams(location.search);
            this.year = searchParams.get('year');
            this.month = searchParams.get('month');
            this.periodLengthMonths = searchParams.get('nummonths');
            this.currency = searchParams.get('currency');
            hideProfitLossIfNoConvertToCurrency(this.currency, this.shadowRoot);

            this.createReport();
        }

        async createReport() {
            const tokenYearReportsElement = this.shadowRoot.getElementById('tokenyearreports');
            // Get all fungible token entries with contract IDs (not just symbols)
            // This ensures each unique token contract gets its own report
            const tokenEntries = await getAllFungibleTokenEntries();
            // Add NEAR (empty string) as the first entry
            const tokens = [{ contractId: '', symbol: 'NEAR' }, ...tokenEntries.map(e => ({ contractId: e.contractId, symbol: e.symbol }))];
            const summarytablebody = this.shadowRoot.getElementById('summarytablebody');
            const rowTemplate = this.shadowRoot.querySelector('#symmaryrowtemplate');

            this.shadowRoot.getElementById('accountsspan').innerText = (await getAccounts()).join(', ');
            this.shadowRoot.getElementById('yearspan').innerText = this.year;

            const format = getNumberFormatter(this.currency);
            const formatToken = getNumberFormatter();
            let totalBalance = 0;
            let totalEarnings = 0;
            let totalProfit = 0;
            let totalLoss = 0;

            const ignoredFungibleTokens = await getIgnoredFungibleTokens();
            for (const tokenEntry of tokens) {
                const { contractId, symbol } = tokenEntry;
                if (ignoredFungibleTokens.find(t => t.symbol === symbol || t.contractId === contractId)) {
                    continue;
                }
                const tokenreport = document.createElement('year-report-print');
                tokenreport.dataset.year = this.year;
                tokenreport.dataset.month = this.month;
                tokenreport.dataset.periodLengthMonths = this.periodLengthMonths;
                tokenreport.dataset.currency = this.currency;
                // Pass contract ID instead of symbol to ensure proper lookup
                tokenreport.dataset.token = contractId;
                tokenreport.useDataset();

                const result = await tokenreport.createReport();

                if (!isNaN(result.outboundBalance.convertedTotalBalance) && (
                    result.totalReceived !== 0
                    || result.totalStakingReward !== 0
                    || result.totalDeposit !== 0
                    || result.totalWithdrawal !== 0
                )) {
                    const pageBreakElement = document.createElement('div');
                    pageBreakElement.classList.add('pagebreak');
                    tokenYearReportsElement.appendChild(pageBreakElement);

                    tokenYearReportsElement.appendChild(tokenreport);
                    const decimalConversionValue = contractId ? getDecimalConversionValue(contractId) : Math.pow(10, -24);
                    const row = rowTemplate.cloneNode(true).content;
                    const earnings = result.totalReceived + result.totalStakingReward;
                    // Display the symbol (resolved from contract ID if needed)
                    const displaySymbol = contractId === '' ? 'NEAR' : (getTokenSymbol(contractId) || symbol);
                    row.querySelector('.summary_token').innerText = displaySymbol;
                    row.querySelector('.summary_amount').innerText = formatToken(result.outboundBalance.totalBalance * decimalConversionValue);
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
