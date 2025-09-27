import { setProgressbarValue } from '../ui/progress-bar.js';
import { fetchTransactionsForAccount, fetchStakingRewardsForAccountAndPool, fetchFungibleTokenTransactionsForAccount, fixTransactionsBalancesForAccount, fetchTransactionsUsingBalanceTracker } from '../storage/domainobjectstore.js';
import { findStakingPoolsInTransactions } from '../near/stakingpool.js';
import accountsPageComponentHtml from './accounts-page.component.html.js';
import { modalAlert } from '../ui/modal.js';
import { accountsconfigfile, getAccounts, setAccounts } from '../storage/domainobjectstore.js';
import { exists } from '../storage/gitstorage.js';

customElements.define('accounts-page',
    class extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this.readyPromise = this.loadHTML();
        }

        async loadHTML() {
            this.shadowRoot.innerHTML = accountsPageComponentHtml;
            this.accountsTable = this.shadowRoot.querySelector('#accountsTable');

            this.shadowRoot.querySelector('#addAccountButton').onclick = async () => {
                this.addAccountRow();
                await this.storeAccounts();
            }
            document.querySelectorAll('link').forEach(lnk => this.shadowRoot.appendChild(lnk.cloneNode()));

            this.shadowRoot.getElementById('loaddatabutton').addEventListener('click', async () => {
                setProgressbarValue(0);
                try {
                    for (const account of this.getAccounts()) {
                        const transactions = await fetchTransactionsForAccount(account);
                        const stakingAccounts = await findStakingPoolsInTransactions(transactions);
                        for (const stakingAccount of stakingAccounts) {
                            await fetchStakingRewardsForAccountAndPool(account, stakingAccount);
                        }
                        await fetchFungibleTokenTransactionsForAccount(account);
                    }
                    setProgressbarValue(null);
                } catch (e) {
                    setProgressbarValue(null);
                    modalAlert('Error fetching data', e.message);
                }

                this.dispatchChangeEvent();
            });

            this.shadowRoot.getElementById('loadwithbalancetrackerbutton').addEventListener('click', async () => {
                setProgressbarValue(0);
                try {
                    const now = new Date();
                    const yesterday = new Date(now);
                    yesterday.setDate(yesterday.getDate() - 1);

                    for (const account of this.getAccounts()) {
                        setProgressbarValue(0.5, `${account} - Fetching today's data`);

                        // Fetch transactions for the last day using balance tracker
                        const transactions = await fetchTransactionsUsingBalanceTracker(account, yesterday, now);

                        // Process staking and fungible tokens
                        const stakingAccounts = await findStakingPoolsInTransactions(transactions);
                        for (const stakingAccount of stakingAccounts) {
                            await fetchStakingRewardsForAccountAndPool(account, stakingAccount);
                        }
                        await fetchFungibleTokenTransactionsForAccount(account);
                    }
                    setProgressbarValue(null);
                } catch (e) {
                    setProgressbarValue(null);
                    modalAlert('Error fetching data with balance tracker', e.message);
                }

                this.dispatchChangeEvent();
            });

            this.shadowRoot.getElementById('fixtransactionswithoutbalancesbutton').addEventListener('click', async () => {
                setProgressbarValue(0);
                try {
                    for (const account of this.getAccounts()) {
                        await fixTransactionsBalancesForAccount(account);
                    }
                    setProgressbarValue(null);
                } catch (e) {
                    setProgressbarValue(null);
                    modalAlert('Error fixing transactions without balance', e.message);
                }
                this.dispatchChangeEvent();
            });

            if (await exists(accountsconfigfile)) {
                this.setAccounts(await getAccounts());
            }
            return this.shadowRoot;
        }

        dispatchChangeEvent() {
            this.dispatchEvent(new Event('change'));
        }

        addAccountRow(accountname) {
            const accountRowTemplate = this.shadowRoot.querySelector('#accountRowTemplate');
            this.accountsTable.appendChild(accountRowTemplate.content.cloneNode(true));
            const accountsRow = this.accountsTable.lastElementChild;
            const accountNameInput = accountsRow.querySelector('.accountname');
            if (accountname) {
                accountNameInput.value = accountname;
            }
            accountNameInput.addEventListener('change', async (e) => {
                await this.storeAccounts();
                this.dispatchChangeEvent()
            });
            accountsRow.querySelector('.removeAccountButton').onclick = async () => {
                accountsRow.remove();
                await this.storeAccounts();
            };
        }

        setAccounts(accountsArray) {
            this.accountsTable.replaceChildren([]);
            accountsArray.forEach(accountname => this.addAccountRow(accountname));
        }

        getAccounts() {
            return Array.from(this.accountsTable.querySelectorAll('.accountname')).map(e => e.value);
        }

        async storeAccounts() {
            await setAccounts(this.getAccounts());
        }
    });
