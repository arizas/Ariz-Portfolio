import html from './counterparties-page.component.html.js';
import { getAccounts, getTransactionsForAccount, getAllFungibleTokenTransactions, getReceivedAccounts, setReceivedAccounts, getExpenseAccounts, setExpenseAccounts } from '../storage/domainobjectstore.js';
import { getStakingAccounts } from '../near/stakingpool.js';

// Token prices cache, keyed by symbol (uppercase)
let tokenPricesCache = null;

async function fetchTokenPrices() {
    if (tokenPricesCache) return tokenPricesCache;
    try {
        const response = await fetch('https://1click.chaindefuser.com/v0/tokens');
        const tokens = await response.json();
        tokenPricesCache = {};
        for (const t of tokens) {
            if (t.price > 0 && t.symbol) {
                const sym = t.symbol.toUpperCase();
                // Keep the highest price if multiple entries for same symbol
                if (!tokenPricesCache[sym] || t.price > tokenPricesCache[sym]) {
                    tokenPricesCache[sym] = t.price;
                }
            }
        }
        return tokenPricesCache;
    } catch {
        return {};
    }
}

/**
 * Format a BigInt token amount with price-based decimal precision.
 * Shows enough decimals so that: displayedAmount * price = accurate USD value (±$0.005)
 */
function formatTokenAmount(bigIntAmount, decimals, tokenPrice) {
    if (bigIntAmount === 0n) return '0';
    const isNegative = bigIntAmount < 0n;
    const abs = isNegative ? -bigIntAmount : bigIntAmount;
    const absStr = abs.toString();

    let wholePart, decimalPart;
    if (absStr.length <= decimals) {
        wholePart = '0';
        decimalPart = absStr.padStart(decimals, '0');
    } else {
        wholePart = absStr.slice(0, -decimals);
        decimalPart = absStr.slice(-decimals);
    }

    const tokenAmount = parseFloat(wholePart + '.' + decimalPart);
    if (tokenAmount === 0) return '0';

    // Determine decimal places based on USD accuracy
    let decimalPlaces = 2;
    if (tokenPrice && tokenPrice > 0) {
        const usdValue = tokenAmount * tokenPrice;
        if (usdValue < 0.01) {
            // Tiny amounts: show at least 1 significant digit
            decimalPlaces = 0;
            let test = tokenAmount;
            while (test < 1 && decimalPlaces < 8) {
                test *= 10;
                decimalPlaces++;
            }
            decimalPlaces = Math.min(decimalPlaces + 1, 8);
        } else {
            // Normal amounts: ensure USD accuracy to half a cent
            const tokenPrecision = 0.005 / tokenPrice;
            decimalPlaces = Math.min(Math.ceil(-Math.log10(tokenPrecision)), 8);
        }
    }

    let formatted = tokenAmount.toFixed(decimalPlaces);
    formatted = formatted.replace(/\.?0+$/, '');
    if (formatted === '0' && tokenAmount > 0) {
        formatted = tokenAmount.toExponential(4);
    }

    const parts = formatted.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (isNegative ? '-' : '') + parts.join('.');
}

/**
 * Convert a BigInt token amount to USD value using token price.
 */
function tokenToUsd(bigIntAmount, decimals, tokenPrice) {
    if (bigIntAmount === 0n || !tokenPrice) return 0;
    const absStr = (bigIntAmount < 0n ? -bigIntAmount : bigIntAmount).toString();
    let wholePart, decimalPart;
    if (absStr.length <= decimals) {
        wholePart = '0';
        decimalPart = absStr.padStart(decimals, '0');
    } else {
        wholePart = absStr.slice(0, -decimals);
        decimalPart = absStr.slice(-decimals);
    }
    return parseFloat(wholePart + '.' + decimalPart) * tokenPrice;
}

function formatUSD(value) {
    if (value === 0) return '$0';
    if (value < 0.01) return '<$0.01';
    return '$' + value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

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

    // Aggregate totals across all tokens for heuristics
    const totalIncoming = Object.values(stats.tokens).reduce((sum, t) => sum + t.incoming, 0n);
    const totalOutgoing = Object.values(stats.tokens).reduce((sum, t) => sum + t.outgoing, 0n);

    // If the counterparty is calling one of your accounts (incoming only, no outgoing from you to them)
    // and they're sending function call deposits → likely smart contract usage income
    if (totalOutgoing === 0n && totalIncoming > 0n && stats.hasAttachedDeposit) {
        return { suggestion: 'received', reason: 'External deposit to your contract' };
    }

    // If only incoming, never outgoing, and reasonably small number of txns → likely payment/income
    if (totalOutgoing === 0n && totalIncoming > 0n && stats.txCount <= 10) {
        return { suggestion: 'received', reason: 'Incoming-only transfers' };
    }

    // If only outgoing, never incoming, and reasonably small number of txns → likely expense/payment
    if (totalIncoming === 0n && totalOutgoing > 0n && stats.txCount <= 10) {
        return { suggestion: 'expense', reason: 'Outgoing-only transfers' };
    }

    return null;
}

customElements.define('counterparties-page',
    class extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this.sortColumn = 'incomingUsd';
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
            const expenseAccounts = await getExpenseAccounts();
            this.tokenPrices = await fetchTokenPrices();
            const counterparties = {};

            function ensureCounterparty(counterparty) {
                if (!counterparties[counterparty]) {
                    counterparties[counterparty] = {
                        account: counterparty,
                        txCount: 0,
                        tokens: {}, // { symbol: { incoming: 0n, outgoing: 0n, decimals } }
                        hasAttachedDeposit: false,
                        isReceived: !!receivedAccounts[counterparty],
                        isExpense: !!expenseAccounts[counterparty],
                        description: receivedAccounts[counterparty]?.description || expenseAccounts[counterparty]?.description || '',
                        suggestion: null,
                    };
                }
                return counterparties[counterparty];
            }

            function addTokenAmount(cp, symbol, decimals, amount) {
                if (!cp.tokens[symbol]) {
                    cp.tokens[symbol] = { incoming: 0n, outgoing: 0n, decimals };
                }
                if (amount > 0n) cp.tokens[symbol].incoming += amount;
                else if (amount < 0n) cp.tokens[symbol].outgoing += -amount;
            }

            // Scan NEAR transactions
            for (const account of accounts) {
                const transactions = await getTransactionsForAccount(account);
                // Pre-compute changedBalance by comparing consecutive balances (same as year report)
                // Transactions are sorted newest-first
                for (let n = 0; n < transactions.length; n++) {
                    const tx = transactions[n];
                    tx.changedBalance = BigInt(tx.balance) - (
                        n < transactions.length - 1 ? BigInt(transactions[n + 1].balance) : 0n
                    );
                }
                for (const tx of transactions) {
                    const counterparty = tx.signer_id === account ? tx.receiver_id : tx.signer_id;
                    if (!counterparty || ownAccounts[counterparty] || allStakingAccounts[counterparty]) continue;

                    const cp = ensureCounterparty(counterparty);
                    cp.txCount++;
                    addTokenAmount(cp, 'NEAR', 24, tx.changedBalance);

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

                    const cp = ensureCounterparty(counterparty);
                    cp.txCount++;
                    const symbol = tx.ft?.symbol || '?';
                    const decimals = tx.ft?.decimals ?? 24;
                    addTokenAmount(cp, symbol, decimals, BigInt(tx.delta_amount || 0));
                }
            }

            // Compute USD totals and run auto-classification
            for (const [account, stats] of Object.entries(counterparties)) {
                stats.incomingUsd = 0;
                stats.outgoingUsd = 0;
                for (const [symbol, data] of Object.entries(stats.tokens)) {
                    const price = this.tokenPrices?.[symbol.toUpperCase()] || 0;
                    stats.incomingUsd += tokenToUsd(data.incoming, data.decimals, price);
                    stats.outgoingUsd += tokenToUsd(data.outgoing, data.decimals, price);
                }
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
                    cp.isExpense = false;
                    cp.description = cp.description || cp.suggestion.reason;
                }
                if (cp.suggestion && cp.suggestion.suggestion === 'expense' && !cp.isExpense) {
                    cp.isExpense = true;
                    cp.isReceived = false;
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
            else if (filter === 'expense') entries = entries.filter(cp => cp.isExpense);
            else if (filter === 'deposit') entries = entries.filter(cp => !cp.isReceived && !cp.isExpense);
            else if (filter === 'suggested') entries = entries.filter(cp => cp.suggestion && !cp.isReceived && !cp.isExpense);

            const col = this.sortColumn;
            entries.sort((a, b) => {
                let va = a[col], vb = b[col];
                if (col === 'classification') {
                    const ca = a.isReceived ? 'received' : a.isExpense ? 'expense' : 'deposit';
                    const cb = b.isReceived ? 'received' : b.isExpense ? 'expense' : 'deposit';
                    const diff = ca.localeCompare(cb);
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
            const expenseCount = Object.values(this.counterparties).filter(cp => cp.isExpense).length;
            const totalCount = Object.keys(this.counterparties).length;
            this.shadowRoot.getElementById('statsSpan').textContent =
                `${receivedCount} received / ${expenseCount} expense / ${totalCount} total counterparties (showing ${entries.length})`;

            for (const cp of entries) {
                const tr = document.createElement('tr');

                // Format per-token amounts
                const formatTokenList = (getValue) => {
                    const lines = [];
                    for (const [symbol, data] of Object.entries(cp.tokens)) {
                        const val = getValue(data);
                        if (val > 0n) {
                            const price = this.tokenPrices?.[symbol.toUpperCase()] || 0;
                            lines.push(`${formatTokenAmount(val, data.decimals, price)} ${symbol}`);
                        }
                    }
                    return lines.join('<br>') || '0';
                };

                const suggestionBadgeClass = cp.suggestion
                    ? (cp.suggestion.suggestion === 'received' ? 'bg-info' : cp.suggestion.suggestion === 'expense' ? 'bg-warning' : 'bg-secondary')
                    : '';
                const suggestionHtml = cp.suggestion
                    ? `<span class="badge suggestion-badge ${suggestionBadgeClass}">${cp.suggestion.reason}</span>`
                    : '';

                const classification = cp.isReceived ? 'received' : cp.isExpense ? 'expense' : 'deposit';
                tr.innerHTML = `
                    <td><select class="form-select form-select-sm classification-select" data-account="${cp.account}">
                        <option value="deposit" ${classification === 'deposit' ? 'selected' : ''}>deposit/withdrawal</option>
                        <option value="received" ${classification === 'received' ? 'selected' : ''}>received</option>
                        <option value="expense" ${classification === 'expense' ? 'selected' : ''}>expense</option>
                    </select></td>
                    <td class="text-break">${cp.account}</td>
                    <td class="text-end">${cp.txCount}</td>
                    <td class="text-end">${formatTokenList(d => d.incoming)}</td>
                    <td class="text-end">${formatUSD(cp.incomingUsd)}</td>
                    <td class="text-end">${formatTokenList(d => d.outgoing)}</td>
                    <td class="text-end">${formatUSD(cp.outgoingUsd)}</td>
                    <td>${suggestionHtml}</td>
                    <td><input type="text" class="form-control form-control-sm description-input" data-account="${cp.account}" value="${cp.description || ''}" placeholder="Description..."></td>
                `;
                tbody.appendChild(tr);
            }

            // Attach classification select listeners
            tbody.querySelectorAll('.classification-select').forEach(sel => {
                sel.addEventListener('change', () => {
                    const cp = this.counterparties[sel.dataset.account];
                    cp.isReceived = sel.value === 'received';
                    cp.isExpense = sel.value === 'expense';
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
            const expenseCount = Object.values(this.counterparties).filter(cp => cp.isExpense).length;
            const totalCount = Object.keys(this.counterparties).length;
            const shownCount = this.shadowRoot.getElementById('counterpartyTableBody').children.length;
            this.shadowRoot.getElementById('statsSpan').textContent =
                `${receivedCount} received / ${expenseCount} expense / ${totalCount} total counterparties (showing ${shownCount})`;
        }

        async save() {
            const receivedAccounts = {};
            const expenseAccounts = {};
            for (const [account, cp] of Object.entries(this.counterparties)) {
                if (cp.isReceived) {
                    receivedAccounts[account] = { description: cp.description || '' };
                }
                if (cp.isExpense) {
                    expenseAccounts[account] = { description: cp.description || '' };
                }
            }
            await setReceivedAccounts(receivedAccounts);
            await setExpenseAccounts(expenseAccounts);
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
