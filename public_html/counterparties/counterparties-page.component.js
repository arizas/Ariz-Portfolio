import html from './counterparties-page.component.html.js';
import { getAccounts, getTransactionsForAccount, getAllFungibleTokenTransactions, getReceivedAccounts, setReceivedAccounts } from '../storage/domainobjectstore.js';
import { getStakingAccounts } from '../near/stakingpool.js';

/**
 * Auto-classification heuristics for counterparty accounts.
 * Returns { suggestion: string, reason: string } or null if no suggestion.
 */
function classifyCounterparty(account, stats, ownAccounts, stakingAccounts) {
    // Skip own accounts and staking pools - handled separately
    if (ownAccounts[account]) return null;
    if (stakingAccounts[account]) return null;

    // Known DEX / swap contracts → deposit (default, no suggestion needed)
    const dexContracts = [
        'v2.ref-finance.near', 'dclv2.ref-labs.near', 'wrap.near',
        'aurora', 'v1.orderbook.near'
    ];
    if (dexContracts.includes(account)) {
        return { suggestion: 'deposit', reason: 'DEX / swap contract' };
    }

    // Intents / multi-chain bridge
    if (account === 'intents.near' || account.endsWith('.omft.near') || account === 'solver-multichain-asset.near') {
        return { suggestion: 'deposit', reason: 'Intents / bridge' };
    }

    // System account
    if (account === 'system') {
        return { suggestion: 'deposit', reason: 'System (gas/storage refund)' };
    }

    // Known donation / payment platforms → received (income)
    const donationPlatforms = [
        'donate.potlock.near', 'potlock.near', 'v1.potfactory.potlock.near',
        'bulkpayment.near'
    ];
    if (donationPlatforms.some(p => account === p || account.endsWith('.' + p))) {
        return { suggestion: 'received', reason: 'Donation / payment platform' };
    }

    // DAO treasuries and payouts → received (income)
    if (account.includes('.sputnik-dao.near') || account.includes('sputnikdao')) {
        return { suggestion: 'received', reason: 'DAO payout' };
    }

    // NEAR Foundation / ecosystem payments
    if (account === 'near' || account === 'near.near' || account.startsWith('nf-')
        || account === 'neardevgov.near' || account === 'devhub.near') {
        return { suggestion: 'received', reason: 'NEAR ecosystem / foundation' };
    }

    // If the counterparty is calling one of your accounts (incoming only, no outgoing from you to them)
    // and they're sending function call deposits → likely smart contract usage income
    if (stats.totalOutgoing === 0n && stats.totalIncoming > 0n && stats.hasAttachedDeposit) {
        return { suggestion: 'received', reason: 'External deposit to your contract' };
    }

    // If only incoming, never outgoing, and reasonably small number of txns → likely payment/income
    if (stats.totalOutgoing === 0n && stats.totalIncoming > 0n && stats.txCount <= 10) {
        return { suggestion: 'received', reason: 'Incoming-only transfers' };
    }

    return null;
}

customElements.define('counterparties-page',
    class extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this.sortColumn = 'totalIncoming';
            this.sortDesc = true;
            this.counterparties = {};
            this.readyPromise = this.loadHTML();
        }

        async loadHTML() {
            this.shadowRoot.innerHTML = html;
            document.querySelectorAll('link').forEach(lnk => this.shadowRoot.appendChild(lnk.cloneNode()));

            // Set up event listeners
            this.shadowRoot.getElementById('searchInput').addEventListener('input', () => this.renderTable());
            this.shadowRoot.getElementById('filterSelect').addEventListener('change', () => this.renderTable());
            this.shadowRoot.getElementById('saveBtn').addEventListener('click', () => this.save());
            this.shadowRoot.getElementById('autoClassifyBtn').addEventListener('click', () => this.applyAutoClassification());

            // Sort headers
            this.shadowRoot.querySelectorAll('th[data-sort]').forEach(th => {
                th.addEventListener('click', () => {
                    const col = th.dataset.sort;
                    if (this.sortColumn === col) {
                        this.sortDesc = !this.sortDesc;
                    } else {
                        this.sortColumn = col;
                        this.sortDesc = true;
                    }
                    this.renderTable();
                });
            });

            await this.loadData();
            return this.shadowRoot;
        }

        async loadData() {
            const accounts = await getAccounts();
            const ownAccounts = {};
            accounts.forEach(a => ownAccounts[a] = true);

            const allStakingAccounts = {};
            for (const account of accounts) {
                const pools = await getStakingAccounts(account);
                pools.forEach(p => allStakingAccounts[p] = true);
            }

            const receivedAccounts = await getReceivedAccounts();
            const counterparties = {};

            // Scan NEAR transactions
            for (const account of accounts) {
                const transactions = await getTransactionsForAccount(account);
                for (const tx of transactions) {
                    // Determine counterparty for this transaction
                    const counterparty = tx.signer_id === account ? tx.receiver_id : tx.signer_id;
                    if (!counterparty || ownAccounts[counterparty] || allStakingAccounts[counterparty]) continue;

                    if (!counterparties[counterparty]) {
                        counterparties[counterparty] = {
                            account: counterparty,
                            txCount: 0,
                            totalIncoming: 0n,
                            totalOutgoing: 0n,
                            hasAttachedDeposit: false,
                            isReceived: !!receivedAccounts[counterparty],
                            description: receivedAccounts[counterparty]?.description || '',
                            suggestion: null,
                        };
                    }
                    const cp = counterparties[counterparty];
                    cp.txCount++;

                    const balance = BigInt(tx.balance);
                    const prevBalance = tx._prevBalance ? BigInt(tx._prevBalance) : null;

                    // Use changedBalance-style logic: determine if incoming or outgoing
                    if (tx.signer_id !== account) {
                        // External signer → this is incoming to our account
                        const changed = prevBalance !== null ? balance - prevBalance : 0n;
                        if (changed > 0n) cp.totalIncoming += changed;
                        else cp.totalOutgoing += -changed;
                    } else {
                        // We are signer → outgoing
                        const changed = prevBalance !== null ? balance - prevBalance : 0n;
                        if (changed < 0n) cp.totalOutgoing += -changed;
                        else cp.totalIncoming += changed;
                    }

                    if (tx.args?.deposit && tx.args.deposit !== '0') {
                        cp.hasAttachedDeposit = true;
                    }
                }
            }

            // Scan fungible token transactions
            for (const account of accounts) {
                const ftTransactions = await getAllFungibleTokenTransactions(account);
                for (const tx of ftTransactions) {
                    const counterparty = tx.involved_account_id;
                    if (!counterparty || ownAccounts[counterparty] || allStakingAccounts[counterparty]) continue;

                    if (!counterparties[counterparty]) {
                        counterparties[counterparty] = {
                            account: counterparty,
                            txCount: 0,
                            totalIncoming: 0n,
                            totalOutgoing: 0n,
                            hasAttachedDeposit: false,
                            isReceived: !!receivedAccounts[counterparty],
                            description: receivedAccounts[counterparty]?.description || '',
                            suggestion: null,
                        };
                    }
                    const cp = counterparties[counterparty];
                    cp.txCount++;
                    // FT amounts are signed: positive = incoming, negative = outgoing
                    const amount = BigInt(tx.delta_amount || 0);
                    if (amount > 0n) cp.totalIncoming += amount;
                    else cp.totalOutgoing += -amount;
                }
            }

            // Run auto-classification
            for (const [account, stats] of Object.entries(counterparties)) {
                stats.suggestion = classifyCounterparty(account, stats, ownAccounts, allStakingAccounts);
            }

            this.counterparties = counterparties;
            this.shadowRoot.getElementById('loadingIndicator').style.display = 'none';
            this.renderTable();
        }

        applyAutoClassification() {
            for (const [account, cp] of Object.entries(this.counterparties)) {
                if (cp.suggestion && cp.suggestion.suggestion === 'received' && !cp.isReceived) {
                    cp.isReceived = true;
                    cp.description = cp.description || cp.suggestion.reason;
                }
            }
            this.renderTable();
        }

        getFilteredAndSorted() {
            const search = this.shadowRoot.getElementById('searchInput').value.toLowerCase();
            const filter = this.shadowRoot.getElementById('filterSelect').value;

            let entries = Object.values(this.counterparties);

            if (search) {
                entries = entries.filter(cp => cp.account.toLowerCase().includes(search)
                    || (cp.description && cp.description.toLowerCase().includes(search))
                    || (cp.suggestion?.reason && cp.suggestion.reason.toLowerCase().includes(search)));
            }

            if (filter === 'received') entries = entries.filter(cp => cp.isReceived);
            else if (filter === 'deposit') entries = entries.filter(cp => !cp.isReceived);
            else if (filter === 'suggested') entries = entries.filter(cp => cp.suggestion?.suggestion === 'received');

            const col = this.sortColumn;
            entries.sort((a, b) => {
                let va = a[col], vb = b[col];
                if (typeof va === 'bigint') {
                    const diff = va > vb ? 1 : va < vb ? -1 : 0;
                    return this.sortDesc ? -diff : diff;
                }
                if (typeof va === 'boolean') {
                    const diff = (va === vb) ? 0 : va ? -1 : 1;
                    return this.sortDesc ? -diff : diff;
                }
                if (typeof va === 'string') {
                    const diff = va.localeCompare(vb || '');
                    return this.sortDesc ? -diff : diff;
                }
                if (col === 'suggestion') {
                    const sa = a.suggestion?.suggestion || '';
                    const sb = b.suggestion?.suggestion || '';
                    const diff = sa.localeCompare(sb);
                    return this.sortDesc ? -diff : diff;
                }
                const diff = (va || 0) - (vb || 0);
                return this.sortDesc ? -diff : diff;
            });

            return entries;
        }

        renderTable() {
            const entries = this.getFilteredAndSorted();
            const tbody = this.shadowRoot.getElementById('counterpartyTableBody');
            tbody.innerHTML = '';

            // Update sort indicators
            this.shadowRoot.querySelectorAll('th[data-sort]').forEach(th => {
                th.classList.remove('sort-indicator', 'desc');
                if (th.dataset.sort === this.sortColumn) {
                    th.classList.add('sort-indicator');
                    if (this.sortDesc) th.classList.add('desc');
                }
            });

            const receivedCount = Object.values(this.counterparties).filter(cp => cp.isReceived).length;
            const totalCount = Object.keys(this.counterparties).length;
            this.shadowRoot.getElementById('statsSpan').textContent =
                `${receivedCount} received / ${totalCount} total counterparties (showing ${entries.length})`;

            for (const cp of entries) {
                const tr = document.createElement('tr');
                const incomingNear = (Number(cp.totalIncoming) / 1e24).toFixed(2);
                const outgoingNear = (Number(cp.totalOutgoing) / 1e24).toFixed(2);

                const suggestionHtml = cp.suggestion
                    ? `<span class="badge suggestion-badge ${cp.suggestion.suggestion === 'received' ? 'bg-info' : 'bg-secondary'}">${cp.suggestion.reason}</span>`
                    : '';

                tr.innerHTML = `
                    <td class="text-center"><input type="checkbox" class="form-check-input received-check" data-account="${cp.account}" ${cp.isReceived ? 'checked' : ''}></td>
                    <td class="text-break">${cp.account}</td>
                    <td class="text-end">${cp.txCount}</td>
                    <td class="text-end">${incomingNear}</td>
                    <td class="text-end">${outgoingNear}</td>
                    <td>${suggestionHtml}</td>
                    <td><input type="text" class="form-control form-control-sm description-input" data-account="${cp.account}" value="${cp.description || ''}" placeholder="Description..."></td>
                `;
                tbody.appendChild(tr);
            }

            // Attach checkbox listeners
            tbody.querySelectorAll('.received-check').forEach(cb => {
                cb.addEventListener('change', () => {
                    this.counterparties[cb.dataset.account].isReceived = cb.checked;
                    this.updateStats();
                });
            });

            // Attach description listeners
            tbody.querySelectorAll('.description-input').forEach(input => {
                input.addEventListener('change', () => {
                    this.counterparties[input.dataset.account].description = input.value;
                });
            });
        }

        updateStats() {
            const receivedCount = Object.values(this.counterparties).filter(cp => cp.isReceived).length;
            const totalCount = Object.keys(this.counterparties).length;
            const shownCount = this.shadowRoot.getElementById('counterpartyTableBody').children.length;
            this.shadowRoot.getElementById('statsSpan').textContent =
                `${receivedCount} received / ${totalCount} total counterparties (showing ${shownCount})`;
        }

        async save() {
            const receivedAccounts = {};
            for (const [account, cp] of Object.entries(this.counterparties)) {
                if (cp.isReceived) {
                    receivedAccounts[account] = { description: cp.description || '' };
                }
            }
            await setReceivedAccounts(receivedAccounts);
            const btn = this.shadowRoot.getElementById('saveBtn');
            btn.textContent = 'Saved!';
            btn.classList.replace('btn-outline-success', 'btn-success');
            setTimeout(() => {
                btn.textContent = 'Save';
                btn.classList.replace('btn-success', 'btn-outline-success');
            }, 2000);
        }
    }
);
