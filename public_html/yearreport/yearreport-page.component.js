import { getCurrencyList } from '../pricedata/pricedata.js';
import html from './yearreport-page.component.html.js';
import { getAllFungibleTokenSymbols } from '../storage/domainobjectstore.js';
import { renderYearReportTable } from './yearreport-table-renderer.js';

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
            await renderYearReportTable({
                shadowRoot: this.shadowRoot,
                token: this.token,
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
                        const transactions = transactionsByDate[datestring];
                        this.transactionsModalElement.querySelector('.modal-title').innerHTML = `Transactions ${datestring}`;
                        this.transactionsModalElement.querySelector('.modal-body').innerHTML = `
                <div class="table-responsive">
                    <table class="table table-sm table-dark">
                    <thead>
                        <th>Signer</th>
                        <th>Received</th>
                        <th>Changed balance</th>
                        <th></th>
                    </thead>
                    <tbody>
                    ${transactions ? transactions.map(tx => `<tr>
${this.token ? `<td>${tx.involved_account_id}</td><td>${tx.affected_account_id}</td><td>${tx.delta_amount * decimalConversionValue}</td>` :
                                `<td>${tx.signer_id}</td><td>${tx.receiver_id}</td><td>${tx.visibleChangedBalance}</td>`}
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