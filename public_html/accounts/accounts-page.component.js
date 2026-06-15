import { setProgressbarValue } from '../ui/progress-bar.js';
import { fetchTransactionsFromAccountingExport } from '../storage/domainobjectstore.js';
import accountsPageComponentHtml from './accounts-page.component.html.js';
import { modalAlert } from '../ui/modal.js';
import { accountsconfigfile, getAccounts, setAccounts } from '../storage/domainobjectstore.js';
import { exists } from '../storage/gitstorage.js';
import { getAccountId, signAndSendTransaction, loginToArizGateway } from '../arizgateway/arizgatewayaccess.js';
import {
    ARIZCREDITS_CONTRACT_ID,
    formatAriz,
    parseAriz,
    getArizBalance,
    getAuthorisation,
    getStorageBalance,
    authorizeAction,
    ftTransferAction,
    storageDepositAction,
} from '../arizcredits/arizcredits.js';

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

            this.shadowRoot.getElementById('fundallbutton').addEventListener('click', () => this.fundAll());

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
                this.refreshRowStatus(accountsRow);
                this.dispatchChangeEvent();
            });
            accountsRow.querySelector('.removeAccountButton').onclick = async () => {
                accountsRow.remove();
                await this.storeAccounts();
            };
            accountsRow.querySelector('.fundButton').onclick = () => this.fundRow(accountsRow);
            accountsRow.querySelector('.authorizeButton').onclick = () => this.authorizeRow(accountsRow);

            if (accountname) this.refreshRowStatus(accountsRow);
        }

        rowAccountId(row) {
            return (row.querySelector('.accountname').value || '').trim();
        }

        // Load ARIZ balance + authorisation status for a row's account (best-effort).
        async refreshRowStatus(row) {
            const statusEl = row.querySelector('.arizstatus');
            const accountId = this.rowAccountId(row);
            if (!accountId) { statusEl.textContent = ''; return; }
            statusEl.textContent = 'checking ARIZ status…';
            try {
                const [balance, auth] = await Promise.all([getArizBalance(accountId), getAuthorisation(accountId)]);
                const funded = BigInt(balance || '0') > 0n;
                const bits = [`balance: ${formatAriz(balance)} ARIZ`,
                    auth ? `authorised ${formatAriz(auth.max_per_day)}/day` : 'not authorised'];
                const ready = funded && auth;
                statusEl.textContent = `${ready ? '✓ ready to sync — ' : ''}${bits.join(' · ')}`;
                statusEl.classList.toggle('text-success', ready);
                statusEl.classList.toggle('text-muted', !ready);
            } catch (e) {
                statusEl.textContent = 'could not read ARIZ status';
            }
        }

        // Send ARIZ to this row's account from the connected wallet (registering it first if needed).
        async fundRow(row) {
            const accountId = this.rowAccountId(row);
            if (!accountId) return;
            const amount = row.querySelector('.fundamount').value;
            if (!amount || Number(amount) <= 0) {
                return modalAlert('Enter an amount', 'Enter how much ARIZ to fund.');
            }
            try {
                if (!(await getAccountId())) {
                    await modalAlert('Log in first', 'Connect a wallet (Login, top right) to fund from — it sends ARIZ to this account.');
                    return;
                }
                setProgressbarValue('indeterminate', `Funding ${accountId} with ${amount} ARIZ…`);
                const actions = [];
                const storage = await getStorageBalance(accountId);
                if (!storage) actions.push(storageDepositAction(accountId)); // register to receive ARIZ
                actions.push(ftTransferAction(accountId, parseAriz(amount)));
                await signAndSendTransaction(ARIZCREDITS_CONTRACT_ID, actions);
                setProgressbarValue(null);
                await this.refreshRowStatus(row);
            } catch (e) {
                setProgressbarValue(null);
                modalAlert('Funding failed', e?.message || String(e));
            }
        }

        // Authorize the gateway to deduct from this account — must be signed by the account itself.
        async authorizeRow(row) {
            const accountId = this.rowAccountId(row);
            if (!accountId) return;
            const cap = row.querySelector('.fundamount').value;
            if (!cap || Number(cap) <= 0) {
                return modalAlert('Enter a daily cap', 'Enter the ARIZ/day cap (the amount field) before authorising.');
            }
            try {
                let connected = await getAccountId();
                if (connected !== accountId) {
                    await modalAlert('Connect this account',
                        `Authorisation must be signed by <b>${accountId}</b> itself. You'll be asked to connect its wallet.`);
                    await loginToArizGateway();
                    connected = await getAccountId();
                }
                if (connected !== accountId) {
                    return modalAlert('Account mismatch',
                        `Connected as <b>${connected || 'nobody'}</b>, but this row is <b>${accountId}</b>. Connect that account and try again.`);
                }
                setProgressbarValue('indeterminate', `Authorising ${accountId}…`);
                await signAndSendTransaction(ARIZCREDITS_CONTRACT_ID, [authorizeAction(parseAriz(cap))]);
                setProgressbarValue(null);
                await this.refreshRowStatus(row);
            } catch (e) {
                setProgressbarValue(null);
                modalAlert('Authorisation failed', e?.message || String(e));
            }
        }

        // Fund every listed account that currently holds no ARIZ, from the connected wallet.
        async fundAll() {
            if (!(await getAccountId())) {
                return modalAlert('Log in first', 'Connect a wallet to fund from.');
            }
            const rows = Array.from(this.accountsTable.querySelectorAll('.account-row'))
                .filter(r => this.rowAccountId(r));
            for (const row of rows) {
                const accountId = this.rowAccountId(row);
                let balance = '0';
                try { balance = await getArizBalance(accountId); } catch { /* treat as unfunded */ }
                if (BigInt(balance || '0') > 0n) continue; // already funded
                await this.fundRow(row);
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
