import { getCurrencyList } from '../pricedata/pricedata.js';
import html from './yearreport-page.component.html.js';
import { getAllFungibleTokenEntries } from '../storage/domainobjectstore.js';
import { resolveDisplaySymbol } from '../near/intents-tokens.js';
import { renderMonthPeriodReportTable, getNumberFormatter } from './yearreport-table-renderer.js';
import { sizeToViewportBottom, onViewportLayoutChange } from '../ui/viewport-table-sizer.js';

// The attached deposit is yoctoNEAR, as a decimal string too long for a Number
// to hold exactly. This used to go through a `nearApi` global that is not
// defined anywhere in this app, so every click on the transactions button threw
// before it drew a row.
/**
 * A daily balance snapshot from the accounting export, not a transaction: it
 * carries a synthetic `block-<height>` hash — which links nowhere on an explorer
 * — and moves nothing.
 */
export function isBalanceMarker(tx) {
    const movedNothing = Number(tx?.visibleChangedBalance ?? 0) === 0
        && (tx?.delta_amount === undefined || Number(tx.delta_amount) === 0);
    return movedNothing && typeof tx?.hash === 'string' && tx.hash.startsWith('block-');
}

export function formatAttachedDeposit(yocto) {
    if (yocto === undefined || yocto === null || yocto === '') return '';
    let digits;
    try {
        digits = BigInt(yocto).toString();
    } catch {
        return '';
    }
    const padded = digits.padStart(25, '0');
    const whole = padded.slice(0, -24).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const fraction = padded.slice(-24).replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole;
}

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
            const periodLengthMonthsInput = this.shadowRoot.querySelector('#periodlengthmonths');
            this.periodLengthMonths = parseInt(periodLengthMonthsInput.value);
            periodLengthMonthsInput.addEventListener('change', () => {
                this.periodLengthMonths = parseInt(periodLengthMonthsInput.value);
                this.refreshView()
            });

            const tokenselect = this.shadowRoot.querySelector('#tokenselect');
            const tokenEntries = await getAllFungibleTokenEntries();
            this.tokenEntries = tokenEntries;
            this.displaySymbols = new Map();
            for (const entry of tokenEntries) {
                const symboloption = document.createElement('option');
                // Use contract_id as value to ensure uniqueness
                symboloption.value = entry.contractId;
                // Display with network info for intents tokens
                symboloption.text = await resolveDisplaySymbol(entry.contractId, entry.symbol);
                // Two contracts can share a symbol — NPRO and wNEAR each exist
                // natively and inside intents. Combined, they would appear twice
                // under one name; this is the name the selector already gives them.
                this.displaySymbols.set(entry.contractId, symboloption.text);
                tokenselect.appendChild(symboloption);
            }

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
                window.open(`year-report-print?token=${this.token}&year=${this.year}&month=${this.month}&nummonths=${this.periodLengthMonths}&currency=${this.convertToCurrency}`);
            });
            this.shadowRoot.querySelector('#print_all_tokens_button').addEventListener('click', () => {
                window.open(`yearsummary-alltokens-print?year=${this.year}&month=${this.month}&nummonths=${this.periodLengthMonths}&currency=${this.convertToCurrency}`);
            });
            this.transactionsModalElement = this.shadowRoot.querySelector('#show_transactions_modal');
            this.showTransactionsModal = new bootstrap.Modal(this.transactionsModalElement);

            return this.shadowRoot;
        }

        connectedCallback() {
            // Safe to run twice: custom elements get this on every insertion.
            this._viewportLayout ??= onViewportLayoutChange(() => this._sizeTableViewport());
        }

        disconnectedCallback() {
            this._viewportLayout?.stop();
            this._viewportLayout = undefined;
        }

        /**
         * Keep the daily-balance table filling the screen below its own top
         * edge — including after a rotation, which a height computed once at
         * render time does not survive.
         *
         * Addressed by id, not by class: the transaction modal injects a second
         * `.table-responsive` into this same shadow root.
         */
        _sizeTableViewport() {
            sizeToViewportBottom(this.shadowRoot.querySelector('#dailybalancescontainer'),
                { hasContent: this.shadowRoot.querySelector('#dailybalancestable')?.childElementCount > 0 });
        }

        async updateView(convertToCurrency, numDecimals, token) {
            this.convertToCurrency = convertToCurrency;
            this.numDecimals = numDecimals;
            this.token = token;
            await this.refreshView();
        }

        /**
         * What a day was made of. With one token that is the transactions; with
         * every token it is also which tokens made up the day's figures, because
         * the whole point of the combined row is being able to take it apart.
         */
        transactionsModalBody({ transactions, decimalConversionValue, allTokens, tokenBreakdown }) {
            const formatNumber = getNumberFormatter(this.convertToCurrency);
            const label = (t) => this.displaySymbols?.get(t.token) ?? t.symbol ?? '';

            const all = [...(transactions ?? [])]
                .sort((a, b) => Number(BigInt(a.block_timestamp) - BigInt(b.block_timestamp)));
            // The accounting export emits a daily balance marker per account per
            // token, with a synthetic hash and nothing moved. In a list meant to
            // show what happened on a day they are noise with a dead link — but
            // they are counted, so the list is not quietly shorter than the data.
            const sorted = all.filter(tx => !isBalanceMarker(tx));
            const markers = all.length - sorted.length;

            const breakdown = allTokens && tokenBreakdown?.length ? `
                <table class="table table-sm table-dark">
                <thead><th>Token</th><th>Received</th><th>Deposit</th><th>Withdrawal</th><th>Expense</th><th>Reward</th></thead>
                <tbody>
                ${tokenBreakdown.map(t => `<tr>
                    <td>${label(t)}${t.priced === false ? ' <span class="text-warning">(no price)</span>' : ''}</td>
                    <td>${formatNumber(t.received)}</td>
                    <td>${formatNumber(t.deposit)}</td>
                    <td>${formatNumber(t.withdrawal)}</td>
                    <td>${formatNumber(t.expense)}</td>
                    <td>${formatNumber(t.stakingReward)}</td>
                </tr>`).join('')}
                </tbody>
                </table>` : '';

            // A transaction is shaped by which ledger it came from: native NEAR
            // rows name a signer and a receiver, fungible token rows name your
            // account and the counterparty. Combined, that has to be decided per
            // transaction rather than once for the whole table.
            const isFungible = (tx) => allTokens ? !!tx.token : !!this.token;
            const decimalsFor = (tx) => allTokens ? (tx.decimalConversionValue ?? 1) : decimalConversionValue;

            return `
                ${breakdown}
                <div class="table-responsive">
                    <table class="table table-sm table-dark">
                    <thead>
                        <th>Time</th>
                        ${allTokens ? '<th>Token</th>' : ''}
                        <th>Counterparty</th>
                        <th>Account</th>
                        <th>Changed balance</th>
                        <th>Attached deposit</th>
                        <th></th>
                    </thead>
                    <tbody>
                    ${sorted.map(tx => `<tr>
                        <td>${new Date(Number(BigInt(tx.block_timestamp) / 1_000_000n)).toJSON().substring('yyyy-MM-dd '.length)}</td>
                        ${allTokens ? `<td>${label(tx)}</td>` : ''}
${isFungible(tx) ? `<td>${tx.involved_account_id ?? ''}</td><td>${tx.account_id ?? ''}</td><td>${tx.delta_amount * decimalsFor(tx)}</td>` :
                    `<td>${tx.signer_id}</td><td>${tx.receiver_id}</td><td>${tx.visibleChangedBalance}</td>`}
<td>${formatAttachedDeposit(tx.args?.deposit)}</td>
<td><a class="btn btn-light" target="_blank" href="https://nearblocks.io/txns/${tx.hash}">&#128194;</a></td>
</tr>`).join('')}
                    </tbody>
                    </table>
                    </div>
                    ${markers ? `<p class="text-muted small mb-0">${markers} daily balance marker${markers === 1 ? '' : 's'} not shown — they record a balance, they do not move anything.</p>` : ''}
                `;
        }

        async refreshView() {
            const progress = this.shadowRoot.querySelector('#reportprogress');
            await renderMonthPeriodReportTable({
                shadowRoot: this.shadowRoot,
                token: this.token,
                month: this.month,
                periodLengthMonths: this.periodLengthMonths,
                year: this.year,
                convertToCurrency: this.convertToCurrency,
                numDecimals: this.numDecimals,
                tokens: this.tokenEntries,
                onProgress: (message) => { if (progress) progress.innerText = message; },
                perRowFunction: async ({
                    datestring,
                    transactionsByDate,
                    decimalConversionValue,
                    row,
                    allTokens,
                    tokenBreakdown
                }) => {
                    row.querySelector('.show_transactions_button').addEventListener('click', () => {
                        this.transactionsModalElement.querySelector('.modal-title').innerHTML = `Transactions ${datestring}`;
                        this.transactionsModalElement.querySelector('.modal-body').innerHTML =
                            this.transactionsModalBody({
                                transactions: transactionsByDate[datestring],
                                decimalConversionValue, allTokens, tokenBreakdown
                            });
                        this.showTransactionsModal.show();
                    });
                }
            });
            // Once, after the table is built — not once per rendered row.
            this._sizeTableViewport();
        }
    });