import { setProgressbarValue } from '../ui/progress-bar.js';
import { fetchTransactionsForAccount, fetchTransactionsUsingBalanceTracker, fetchStakingRewardsForAccountAndPool, fetchFungibleTokenTransactionsForAccount, fixTransactionsBalancesForAccount, getTransactionsForAccount } from '../storage/domainobjectstore.js';
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
                    // Get the start block from the input field
                    const startBlockInput = this.shadowRoot.getElementById('startBlockInput');
                    const endBlockValue = startBlockInput.value.trim() || 'final';

                    for (const account of this.getAccounts()) {
                        setProgressbarValue(0.1, `Starting balance-based search for ${account} up to block ${endBlockValue}...`);

                        // Parse the end block value to determine the search range
                        let endBlockNum;
                        if (endBlockValue === 'final') {
                            // Will be handled in fetchTransactionsUsingBalanceTracker
                            endBlockNum = Number.MAX_SAFE_INTEGER;
                        } else {
                            endBlockNum = parseInt(endBlockValue);
                        }

                        // Get existing transactions to find the highest block that's less than our search end point
                        const existingTransactions = await getTransactionsForAccount(account);

                        // Find the highest existing block that's still less than the end block
                        // This will be used as the starting point for correct balance state
                        let highestExistingBlock = null;
                        if (existingTransactions && existingTransactions.length > 0 && !isNaN(endBlockNum)) {
                            // Filter transactions that are below our end block
                            const eligibleTransactions = existingTransactions
                                .filter(tx => tx.block_height && tx.block_height < endBlockNum)
                                .sort((a, b) => b.block_height - a.block_height);

                            if (eligibleTransactions.length > 0) {
                                // Add 20 blocks to account for the receipt block (balance changes at receipt, not transaction)
                                // This ensures we start after the balance has been updated
                                highestExistingBlock = eligibleTransactions[0].block_height + 20;
                                console.log(`Found existing transaction at block ${eligibleTransactions[0].block_height}, starting from block ${highestExistingBlock} (after receipt)`);
                            }
                        }

                        // Use balance tracker for efficient transaction discovery
                        // Pass the highest existing block (if any) as the start point for correct balance state
                        // The endBlockValue is what the user entered (could be 'final' or a block number)
                        const result = await fetchTransactionsUsingBalanceTracker(account, highestExistingBlock, endBlockValue);

                        console.log(`Loaded ${result.newTransactionsCount} new transactions for ${account}`);
                        console.log(`Loaded ${result.newFtTransactionsCount} new token transactions`);

                        // Process staking pools if we found transactions
                        if (result.transactions.length > 0) {
                            const stakingAccounts = await findStakingPoolsInTransactions(result.transactions);
                            for (const stakingAccount of stakingAccounts) {
                                await fetchStakingRewardsForAccountAndPool(account, stakingAccount);
                            }
                        }
                    }
                    setProgressbarValue(null);
                } catch (e) {
                    setProgressbarValue(null);
                    modalAlert('Error fetching data', e.message);
                    console.error('Error:', e);
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
