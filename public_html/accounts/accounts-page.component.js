import { setProgressbarValue } from '../ui/progress-bar.js';
import { fetchTransactionsFromAccountingExport, writeConfidentialIntentsHistory } from '../storage/domainobjectstore.js';
import accountsPageComponentHtml from './accounts-page.component.html.js';
import { modalAlert } from '../ui/modal.js';
import { accountsconfigfile, getAccounts, setAccounts } from '../storage/domainobjectstore.js';
import { exists } from '../storage/gitstorage.js';
// Static imports on purpose — a dynamic import() breaks the single-file dist
// (see the dist guard in playwright_tests/tests/wasmgit.spec.js).
import { fetchConfidentialHistory, ConfidentialHistoryUnavailableError } from '../near/intentshistory.js';
import { requireWalletAccount } from '../arizgateway/arizgatewayaccess.js';

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
            };
            document.querySelectorAll('link').forEach(lnk => this.shadowRoot.appendChild(lnk.cloneNode()));

            this.shadowRoot.getElementById('loadfromexportbutton').addEventListener('click', async () => {
                try {
                    for (const account of this.getAccounts()) {
                        setProgressbarValue('indeterminate', `Downloading transaction history for ${account} from server...`);
                        const result = await fetchTransactionsFromAccountingExport(account, { merge: true });

                        console.log(`Loaded ${result.newTransactionsCount} NEAR transactions from server`);
                        console.log(`Loaded ${result.newFtTransactionsCount} token transactions from server`);
                        console.log(`Loaded staking data for ${result.stakingPools?.length || 0} pools from server`);
                    }
                    setProgressbarValue(null);
                } catch (e) {
                    setProgressbarValue(null);
                    modalAlert('Error fetching from accounting export', e.message);
                    console.error('Error:', e);
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
            accountNameInput.addEventListener('change', async () => {
                await this.storeAccounts();
                this.dispatchChangeEvent();
            });
            accountsRow.querySelector('.fetchConfidentialButton').onclick = () =>
                this.fetchConfidentialForAccount(accountNameInput.value.trim());
            accountsRow.querySelector('.removeAccountButton').onclick = async () => {
                accountsRow.remove();
                await this.storeAccounts();
            };
        }

        /**
         * Fetch the confidential NEAR Intents history for one account row.
         * The 1Click API only reveals the SIGNING account's confidential
         * ledger, so the connected wallet must be the row's account — anyone
         * else's confidential data is unreachable by design. The result is
         * stored client-side only (the user's git repository; it leaves the
         * device solely via the encrypted store sync).
         */
        async fetchConfidentialForAccount(account) {
            try {
                if (!account) return;
                const walletAccount = await requireWalletAccount();
                if (walletAccount !== account) {
                    await modalAlert('Wrong wallet for this account',
                        `Confidential intents history can only be fetched by the account owner's wallet. `
                        + `You are signed in as ${walletAccount} — to fetch for ${account}, sign in with that account's wallet first.`);
                    return;
                }
                setProgressbarValue('indeterminate', `Fetching confidential intents history for ${account}…`);
                const items = await fetchConfidentialHistory();
                await writeConfidentialIntentsHistory(account, items);
                setProgressbarValue(null);
                await modalAlert('Confidential history fetched',
                    `${items.length} confidential intents item(s) stored for ${account} — in your repository only, never on the gateway.`);
                this.dispatchChangeEvent();
            } catch (e) {
                setProgressbarValue(null);
                console.error(e);
                await modalAlert(
                    e instanceof ConfidentialHistoryUnavailableError
                        ? 'Confidential history not available'
                        : 'Could not fetch confidential history',
                    e.message ?? e);
            }
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
