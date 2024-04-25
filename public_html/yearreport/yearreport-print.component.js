import html from './yearreport-print.component.html.js';
import { getNumberFormatter, renderYearReportTable } from './yearreport-table-renderer.js';

customElements.define('year-report-print',
    class extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this.shadowRoot.innerHTML = html;

            const searchParams = new URLSearchParams(location.search);
            this.token = searchParams.get('token');
            this.year = searchParams.get('year');
            this.convertToCurrency = searchParams.get('currency');

            if (this.token !== null) {
                this.createReport();
            }
        }

        useDataset() {
            this.year = this.dataset.year;
            this.convertToCurrency = this.dataset.currency;
            this.token = this.dataset.token;
        }

        async createReport() {
            this.shadowRoot.getElementById('yearspan').innerText = this.year;
            this.shadowRoot.getElementById('tokenspan').innerText = this.token ? this.token : 'NEAR';
            this.shadowRoot.getElementById('currencyspan').innerText = this.convertToCurrency;
            document.querySelectorAll('link').forEach(lnk => this.shadowRoot.appendChild(lnk.cloneNode()));
            const transactionstablebody = this.shadowRoot.querySelector('#transactionstablebody');

            const formatNumber = getNumberFormatter(this.convertToCurrency);

            const result = await renderYearReportTable({
                shadowRoot: this.shadowRoot,
                token: this.token,
                year: this.year,
                convertToCurrency: this.convertToCurrency,
                numDecimals: this.numDecimals,
                perRowFunction: async ({
                    datestring,
                    transactionsByDate,
                    decimalConversionValue,
                    numDecimals
                }) => {
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
            
                <td class="numeric">${(tx.delta_amount * decimalConversionValue).toFixed(numDecimals)}</td>`
                                    :
                                    `<td>${tx.signer_id}</td>
                <td>${tx.receiver_id}</td>
                <td>${tx.action_kind}</td>
                <td class="numeric">${tx.visibleChangedBalance.toFixed(numDecimals)}</td>`}
                <td><a class="btn btn-light" target="_blank" href="https://nearblocks.io/txns/${tx.hash}">&#128194;</a>
                </td>`;
                            transactionstablebody.appendChild(transactionRow);
                        }
                    }
                }
            });
            this.shadowRoot.getElementById('totalearnings').innerText = formatNumber(result.totalReceived + result.totalStakingReward);
            return result;
        }
    }
);
