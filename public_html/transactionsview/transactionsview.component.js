import 'https://cdn.jsdelivr.net/npm/near-api-js@0.44.2/dist/near-api-js.min.js';
import { getEODPrice } from '../pricedata/pricedata.js';
import { getTransactionsForAccount } from '../storage/domainobjectstore.js';

customElements.define('transactions-view',
    class extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this.readyPromise = this.loadHTML();
        }

        async loadHTML() {
            this.shadowRoot.innerHTML = await fetch(new URL('transactionsview.component.html', import.meta.url)).then(r => r.text());
            this.transactionsTable = this.shadowRoot.getElementById('transactionstable');
            document.querySelectorAll('link').forEach(lnk => this.shadowRoot.appendChild(lnk.cloneNode()));
            return this.shadowRoot;
        }

        async updateView(account, convertToCurrency, numDecimals) {
            const accountHistory = await getTransactionsForAccount(account);
            const transactionRowTemplate = this.shadowRoot.querySelector('#transactionrowtemplate');
            let totalDeposits = 0;
            let totalWithdrawals = 0;
            while( this.transactionsTable.lastElementChild) {
                this.transactionsTable.removeChild(this.transactionsTable.lastElementChild);
            }

            for (let n = 0; n < accountHistory.length; n++) {
                this.transactionsTable.appendChild(transactionRowTemplate.content.cloneNode(true));
                const transactionRow = this.transactionsTable.lastElementChild;
                const transaction = accountHistory[n];
                const previousbalance = n < (accountHistory.length - 1) ? accountHistory[n + 1].balance : 0;
                const changedBalance = ((transaction.balance - previousbalance) / 1e+24);

                const transactionDateString = new Date(transaction.block_timestamp / 1_000_000).toJSON().substring(0, 'yyyy-MM-dd'.length);
                const conversionRate = convertToCurrency == 'near' ? 1 : await getEODPrice(convertToCurrency, transactionDateString);

                transactionRow.querySelector('.transactionrow_datetime').innerHTML = transactionDateString;
                transactionRow.querySelector('.transactionrow_kind').innerHTML = `${transaction.action_kind}${(transaction.action_kind == 'FUNCTION_CALL' ? `(${transaction.args.method_name})`: '')}`;

                transactionRow.querySelector('.transactionrow_balance').innerHTML = (conversionRate *
                        (parseInt(transaction.balance) / 1e+24)
                    ).toFixed(numDecimals);


                const fiatChangedBalance = (conversionRate * changedBalance);
                transactionRow.querySelector('.transactionrow_change').innerHTML = fiatChangedBalance.toFixed(numDecimals);

                transactionRow.querySelector('.transactionrow_signer').innerHTML = transaction.signer_id;
                transactionRow.querySelector('.transactionrow_receiver').innerHTML = transaction.receiver_id;
                transactionRow.querySelector('.transactionrow_hash').innerHTML = transaction.hash;
            }
        }
    });
