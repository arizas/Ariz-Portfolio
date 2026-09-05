import { setProgressbarValue } from '../ui/progress-bar.js';
import { fetchTransactionsFromAccountingExport, writeConfidentialIntentsHistory,
    reconcileStoredConfidentialBalances } from '../storage/domainobjectstore.js';
import accountsPageComponentHtml from './accounts-page.component.html.js';
import { modalAlert } from '../ui/modal.js';
import { escapeHtml } from '../util/escape-html.js';
import { accountsconfigfile, getAccounts, setAccounts } from '../storage/domainobjectstore.js';
import { exists } from '../storage/gitstorage.js';
// Static imports on purpose — a dynamic import() breaks the single-file dist
// (see the dist guard in playwright_tests/tests/wasmgit.spec.js).
import { fetchConfidentialHistory, fetchConfidentialBalances,
    ConfidentialHistoryUnavailableError } from '../near/intentshistory.js';
import { requireWalletAccount } from '../arizgateway/arizgatewayaccess.js';

/** Raw integer units as a decimal string, for a human-readable mismatch report. */
function formatRawAmount(raw, decimals) {
    if (decimals === undefined) return String(raw);
    const negative = raw < 0n;
    const digits = (negative ? -raw : raw).toString().padStart(decimals + 1, '0');
    const whole = digits.slice(0, digits.length - decimals);
    const fraction = decimals > 0 ? `.${digits.slice(digits.length - decimals)}` : '';
    return `${negative ? '-' : ''}${whole}${fraction}`;
}

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
                const { total, added, updated } = await writeConfidentialIntentsHistory(account, items);

                // Prove the stored history is complete before trusting the
                // numbers it produces — a truncated fetch still adds up.
                setProgressbarValue('indeterminate', 'Reconciling against the confidential ledger…');
                const mismatches = await reconcileStoredConfidentialBalances(
                    account, await fetchConfidentialBalances());
                setProgressbarValue(null);

                // modalAlert renders its content as HTML, and symbols come
                // from the intents token API — escape every interpolated value.
                const summary = `${items.length} item(s) fetched, ${added} new and ${updated} updated — `
                    + `${total} stored for ${escapeHtml(account)}, in your repository only, `
                    + `never on the gateway.`;
                if (mismatches.length > 0) {
                    await modalAlert('Confidential history stored, but it does not add up',
                        `${summary}<br><br>The balances derived from that history disagree with the ones `
                        + `the intents API reports, which means the stored history is incomplete:<br><br>`
                        + mismatches.map((m) => `${escapeHtml(m.symbol ?? m.assetId)}: `
                            + `derived ${formatRawAmount(m.derived, m.decimals)}, `
                            + `actual ${formatRawAmount(m.actual, m.decimals)}`).join('<br>')
                        + `<br><br>Nothing was deleted — the store only ever merges. Fetch again, and `
                        + `report this if it persists.`);
                } else {
                    await modalAlert('Confidential history fetched',
                        `${summary}<br><br>Derived balances match the intents API exactly.`);
                }
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
