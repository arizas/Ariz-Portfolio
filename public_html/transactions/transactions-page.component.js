import { getAccounts, getRecordsForAccount } from '../storage/domainobjectstore.js';
import { resolveDisplaySymbol, resolveDecimals } from '../near/intents-tokens.js';
import { setProgressbarValue } from '../ui/progress-bar.js';
import html from './transactions-page.component.html.js';

const NEAR_DECIMALS = 24;

/**
 * Staking-pool records are excluded from the Transactions page — they are
 * high-frequency periodic-snapshot noise that's better viewed on the dedicated
 * Staking rewards page. Detection is the standard NEAR staking-pool naming
 * convention.
 */
function isStakingPoolToken(tokenId) {
    return tokenId.includes('.poolv1.near') ||
           tokenId.includes('.pool.near') ||
           tokenId.endsWith('.pool.f863973.m0');
}

/**
 * Resolve display info for a token_id once per unique value (records reuse the
 * same token_id heavily). Returns { symbol, decimals } where symbol is e.g.
 * "NEAR", "USDC", or "BTC ( NEAR Intents / Bitcoin )".
 */
async function resolveTokenDisplay(tokenId) {
    if (tokenId === 'near') {
        return { symbol: 'NEAR', decimals: NEAR_DECIMALS };
    }
    const symbol = await resolveDisplaySymbol(tokenId, tokenId);
    const decimals = await resolveDecimals(tokenId, NEAR_DECIMALS);
    return { symbol, decimals };
}

/**
 * Format a yoctoUnits amount with the given decimals as a fixed-point string.
 * Trailing fractional zeros are dropped for readability.
 */
function formatAmount(amountStr, decimals) {
    if (amountStr === undefined || amountStr === null || amountStr === '') return '';
    const negative = amountStr.startsWith('-');
    const abs = negative ? amountStr.slice(1) : amountStr;
    if (decimals === 0) {
        return negative ? `-${abs}` : abs;
    }
    const padded = abs.padStart(decimals + 1, '0');
    const intPart = padded.slice(0, padded.length - decimals);
    const fracPart = padded.slice(padded.length - decimals);
    const trimmedFrac = fracPart.replace(/0+$/, '');
    const body = trimmedFrac ? `${intPart}.${trimmedFrac}` : intPart;
    return negative ? `-${body}` : body;
}

function explorerTxUrl(txHash) {
    return `https://explorer.near.org/transactions/${txHash}`;
}

customElements.define('transactions-page',
    class extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this.readyPromise = this.loadHTML();
        }

        async loadHTML() {
            this.shadowRoot.innerHTML = html;
            this.transactionsTable = this.shadowRoot.getElementById('transactionstable');
            this.emptyState = this.shadowRoot.getElementById('emptystate');
            document.querySelectorAll('link').forEach(lnk => this.shadowRoot.appendChild(lnk.cloneNode()));

            const accountselect = this.shadowRoot.querySelector('#accountselect');
            const accounts = await getAccounts();
            for (const account of accounts) {
                const option = document.createElement('option');
                option.value = account;
                option.text = account;
                accountselect.appendChild(option);
            }

            accountselect.addEventListener('change', () => this.updateView(accountselect.value));

            return this.shadowRoot;
        }

        async updateView(account) {
            setProgressbarValue('indeterminate', `Loading transactions for ${account}…`);
            try {
                await this._renderView(account);
            } finally {
                setProgressbarValue(null);
            }
        }

        async _renderView(account) {
            const allRecords = await getRecordsForAccount(account);
            // Filter out:
            //  - Staking-pool records: high-frequency periodic snapshots belong
            //    on the Staking rewards page, not the transaction list.
            //  - Zero-amount records: balance snapshots where nothing changed,
            //    used by the worker to confirm the current balance. Pure noise
            //    for a "what happened" view.
            const records = allRecords.filter(r => {
                if (isStakingPoolToken(r.token_id)) return false;
                if (r.amount === undefined || r.amount === null) return false;
                try {
                    if (BigInt(r.amount) === 0n) return false;
                } catch {
                    return false;
                }
                return true;
            });

            // Clear table
            while (this.transactionsTable.lastElementChild) {
                this.transactionsTable.removeChild(this.transactionsTable.lastElementChild);
            }

            if (allRecords.length === 0) {
                this.emptyState.style.display = '';
                this.emptyState.textContent = `No records for ${account}. Visit the Accounts page and click "load from server" to fetch.`;
                return;
            }
            this.emptyState.style.display = 'none';

            // Resolve display info once per unique token_id (records reuse the same id heavily)
            const uniqueTokenIds = [...new Set(records.map(r => r.token_id))];
            const displayByToken = new Map();
            await Promise.all(uniqueTokenIds.map(async tid => {
                displayByToken.set(tid, await resolveTokenDisplay(tid));
            }));

            // Sort reverse-chronologically
            const sorted = [...records].sort((a, b) => b.block_height - a.block_height);

            const rowTemplate = this.shadowRoot.querySelector('#transactionrowtemplate');

            for (const rec of sorted) {
                this.transactionsTable.appendChild(rowTemplate.content.cloneNode(true));
                const row = this.transactionsTable.lastElementChild;
                const display = displayByToken.get(rec.token_id);

                const dateString = rec.block_timestamp
                    ? new Date(rec.block_timestamp).toJSON().substring(0, 'yyyy-MM-dd HH:mm'.length).replace('T', ' ')
                    : '';

                row.querySelector('.txrow_datetime').textContent = dateString;
                row.querySelector('.txrow_block').textContent = rec.block_height;
                row.querySelector('.txrow_token_symbol').textContent = display.symbol;
                row.querySelector('.txrow_token_id').textContent = rec.token_id;
                row.querySelector('.txrow_change').textContent = formatAmount(rec.amount, display.decimals);
                row.querySelector('.txrow_balance').textContent = formatAmount(rec.balance_after, display.decimals);
                row.querySelector('.txrow_counterparty').textContent = rec.counterparty ?? '';

                const hashCell = row.querySelector('.txrow_hash');
                if (rec.tx_hash) {
                    const a = document.createElement('a');
                    a.href = explorerTxUrl(rec.tx_hash);
                    a.target = '_blank';
                    a.rel = 'noopener';
                    a.textContent = rec.tx_hash.slice(0, 10) + '…';
                    hashCell.appendChild(a);
                } else {
                    hashCell.textContent = '';
                }
            }

            const tableElement = this.shadowRoot.querySelector('.table-responsive');
            tableElement.style.height = (window.innerHeight - tableElement.getBoundingClientRect().top) + 'px';
        }
    });
