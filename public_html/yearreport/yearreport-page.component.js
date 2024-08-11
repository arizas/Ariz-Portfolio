import { getCurrencyList } from '../pricedata/pricedata.js';
import html from './yearreport-page.component.html.js';
import { getAllFungibleTokenSymbols } from '../storage/domainobjectstore.js';
import { renderPeriodReportTable, renderYearReportTable } from './yearreport-table-renderer.js';

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
            this.month = 0;
            this.monthSelect = this.shadowRoot.querySelector('#monthselect');
            for (let month = 0; month < 12; month++) {
                const monthOption = document.createElement('option');
                monthOption.value = month;
                monthOption.innerHTML = `${new Date(2020,month,1).toLocaleDateString('en-US', {month: 'long'})}`;
                if (month === this.month) {
                    monthOption.selected = true;
                }
                this.monthSelect.appendChild(monthOption);
            }
            this.monthSelect.addEventListener('change', () => {
                this.month = parseInt(this.monthSelect.value);
                this.refreshView()
            });
            const periodLenghtMonthsInput = this.shadowRoot.querySelector('#periodlengthmonths');
            this.periodLenghtMonths = parseInt(periodLenghtMonthsInput.value);
            periodLenghtMonthsInput.addEventListener('change', () => {
                this.periodLenghtMonths = parseInt(periodLenghtMonthsInput.value);
                this.refreshView()
            });

            const tokenselect = this.shadowRoot.querySelector('#tokenselect');
            (await getAllFungibleTokenSymbols()).forEach(symbol => {
                const symboloption = document.createElement('option');
                symboloption.value = symbol;
                symboloption.text = symbol;
                tokenselect.appendChild(symboloption);
            });

            const currencyselect = this.shadowRoot.querySelector('#currencyselect');
            (await getCurrencyList()).forEach(currency => {
                const currencyoption = document.createElement('option');
                currencyoption.value = currency;
                currencyoption.text = currency.toUpperCase();
                currencyselect.appendChild(currencyoption);
            });

            const numDecimals = 2;
            currencyselect.addEventListener('change', () => this.updateView(currencyselect.value, numDecimals, tokenselect.value));
            tokenselect.addEventListener('change', () => this.updateView(currencyselect.value, numDecimals, tokenselect.value));
            this.updateView(currencyselect.value, numDecimals, tokenselect.value);

            this.shadowRoot.querySelector('#print_current_token_button').addEventListener('click', () => {
                window.open(`year-report-print?token=${this.token}&year=${this.year}&currency=${this.convertToCurrency}`);
            });
            this.shadowRoot.querySelector('#print_all_tokens_button').addEventListener('click', () => {
                window.open(`yearsummary-alltokens-print?year=${this.year}&currency=${this.convertToCurrency}`);
            });
            this.transactionsModalElement = this.shadowRoot.querySelector('#show_transactions_modal');
            this.showTransactionsModal = new bootstrap.Modal(this.transactionsModalElement);

            return this.shadowRoot;
        }

        async updateView(convertToCurrency, numDecimals, token) {
            this.convertToCurrency = convertToCurrency;
            this.numDecimals = numDecimals;
            this.token = token;
            await this.refreshView();
        }

        async refreshView() {
            const periodStartDate = new Date(Date.UTC(this.year, this.month, 1));
            let periodEndDate = new Date(Date.UTC(this.year, this.month, 1));
            periodEndDate.setMonth(periodEndDate.getMonth() + this.periodLenghtMonths);
            periodEndDate.setDate(periodEndDate.getDate()-1);

            const maxPeriodEndDate = new Date(new Date(new Date().getTime() - 24 * 60 * 60 * 1000).toJSON().substring(0, 'yyyy-MM-dd'.length));

            if (periodEndDate > maxPeriodEndDate) {
                periodEndDate = maxPeriodEndDate;
            }

            console.log(periodStartDate, periodEndDate);
            await renderPeriodReportTable({
                shadowRoot: this.shadowRoot,
                token: this.token,
                periodStartDate, periodEndDate,
                year: this.year,
                convertToCurrency: this.convertToCurrency,
                numDecimals: this.numDecimals,
                perRowFunction: async ({
                    datestring,
                    transactionsByDate,
                    decimalConversionValue,
                    numDecimals,
                    row
                }) => {
                    row.querySelector('.show_transactions_button').addEventListener('click', () => {
                        const transactions = transactionsByDate[datestring].sort((a, b) => Number(BigInt(a.block_timestamp) - BigInt(b.block_timestamp)));
                        this.transactionsModalElement.querySelector('.modal-title').innerHTML = `Transactions ${datestring}`;
                        this.transactionsModalElement.querySelector('.modal-body').innerHTML = `
                <div class="table-responsive">
                    <table class="table table-sm table-dark">
                    <thead>
                        <th>Time</th>
                        <th>Signer</th>
                        <th>Received</th>                        
                        <th>Changed balance</th>
                        <th>Attached deposit</th>
                        <th></th>
                    </thead>
                    <tbody>
                    ${transactions ? transactions.map(tx => `<tr>
                        <td>${new Date(Number(BigInt(tx.block_timestamp) / 1_000_000n)).toJSON().substring('yyyy-MM-dd '.length)}</td>
${this.token ? `<td>${tx.involved_account_id}</td><td>${tx.affected_account_id}</td><td>${tx.delta_amount * decimalConversionValue}</td>` :
                                `<td>${tx.signer_id}</td><td>${tx.receiver_id}</td><td>${tx.visibleChangedBalance}</td>`}
<td>${nearApi.utils.format.formatNearAmount(tx.args?.deposit)}</td>
<td><a class="btn btn-light" target="_blank" href="https://nearblocks.io/txns/${tx.hash}">&#128194;</button></a>
</tr>`).join('') : ''}
                    </tbody>
                    </table>
                    </div>
                `;
                        this.showTransactionsModal.show();
                    });
                    const tableElement = this.shadowRoot.querySelector('.table-responsive');
                    tableElement.style.height = (window.innerHeight - tableElement.getBoundingClientRect().top) + 'px';
                }
            });
        }
    });