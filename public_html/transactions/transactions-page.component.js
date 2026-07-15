import { getAccounts, getRecordsForAccount, writeConfidentialIntentsHistory } from '../storage/domainobjectstore.js';
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

            this.tokenselect = this.shadowRoot.querySelector('#tokenselect');
            // Re-render from the already-loaded records when the token filter
            // changes — no refetch, just a different view of the same data.
            this.tokenselect.addEventListener('change', () => this._renderTable());

            this.shadowRoot.querySelector('#fetchconfidentialbutton')
                .addEventListener('click', () => this.fetchConfidentialHistory());

            return this.shadowRoot;
        }

        /**
         * Fetch the connected wallet's confidential intents history from the
         * 1Click API (one wallet signature) and store it in the repository —
         * client-side only: the gateway never sees the data, and it syncs only
         * through the end-to-end encrypted store.
         */
        async fetchConfidentialHistory() {
            const statusElement = this.shadowRoot.querySelector('#confidentialstatus');
            const show = (text) => { statusElement.style.display = ''; statusElement.textContent = text; };
            try {
                const [{ fetchConfidentialHistory }, { requireWalletAccount }] = await Promise.all([
                    import('../near/intentshistory.js'),
                    import('../arizgateway/arizgatewayaccess.js'),
                ]);
                const walletAccount = await requireWalletAccount();
                setProgressbarValue('indeterminate', 'Fetching confidential intents history…');
                const items = await fetchConfidentialHistory();
                await writeConfidentialIntentsHistory(walletAccount, items);
                show(`Fetched ${items.length} confidential intents item(s) for ${walletAccount} — stored only in your repository.`);
                const accountselect = this.shadowRoot.querySelector('#accountselect');
                if (accountselect.value === walletAccount) {
                    await this.updateView(walletAccount);
                }
            } catch (e) {
                show(`Could not fetch confidential history: ${e.message}`);
            } finally {
                setProgressbarValue(null);
            }
        }

        async updateView(account) {
            // Bump the generation counter so any in-flight render for a prior
            // account aborts cleanly instead of fighting this one for the table.
            const generation = (this._renderGeneration ?? 0) + 1;
            this._renderGeneration = generation;

            setProgressbarValue('indeterminate', `Loading transactions for ${account}…`);
            try {
                await this._loadAccount(account, generation);
                if (this._renderGeneration !== generation) return;
                await this._renderTable(generation);
            } finally {
                // Only clear the spinner if this is still the latest render —
                // a newer one will manage its own spinner state.
                if (this._renderGeneration === generation) {
                    setProgressbarValue(null);
                }
            }
        }

        async _loadAccount(account, generation) {
            const isCurrent = () => this._renderGeneration === generation;

            const allRecords = await getRecordsForAccount(account);
            if (!isCurrent()) return;

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

            // Resolve display info once per unique token_id (records reuse the same id heavily)
            const uniqueTokenIds = [...new Set(records.map(r => r.token_id))];
            const displayByToken = new Map();
            await Promise.all(uniqueTokenIds.map(async tid => {
                displayByToken.set(tid, await resolveTokenDisplay(tid));
            }));
            if (!isCurrent()) return;

            // Stash for _renderTable (the token-filter change handler re-renders
            // from this without refetching).
            this._account = account;
            this._records = records;
            this._hasAnyRecords = allRecords.length > 0;
            this._displayByToken = displayByToken;
            this._populateTokenSelect(uniqueTokenIds, displayByToken);
        }

        /**
         * Repopulate the token dropdown with the tokens present for the current
         * account (plus the leading "All tokens" entry), sorted by symbol, and
         * reset the filter to "All tokens".
         */
        _populateTokenSelect(uniqueTokenIds, displayByToken) {
            const sel = this.tokenselect;
            while (sel.options.length > 1) sel.remove(1); // keep the "All tokens" option
            const sorted = [...uniqueTokenIds].sort((a, b) =>
                (displayByToken.get(a)?.symbol ?? a).localeCompare(displayByToken.get(b)?.symbol ?? b));
            for (const tid of sorted) {
                const opt = document.createElement('option');
                opt.value = tid;
                opt.text = displayByToken.get(tid)?.symbol ?? tid;
                sel.appendChild(opt);
            }
            sel.value = '';
            sel.disabled = uniqueTokenIds.length === 0;
        }

        async _renderTable(generation) {
            // When invoked from the token-filter change handler there's no
            // generation, so start a fresh one (aborts any in-flight render).
            if (generation === undefined) {
                generation = (this._renderGeneration ?? 0) + 1;
                this._renderGeneration = generation;
            }
            const isCurrent = () => this._renderGeneration === generation;

            // Clear table
            while (this.transactionsTable.lastElementChild) {
                this.transactionsTable.removeChild(this.transactionsTable.lastElementChild);
            }

            if (!this._hasAnyRecords) {
                this.emptyState.style.display = '';
                this.emptyState.textContent = `No records for ${this._account}. Visit the Accounts page and click "load from server" to fetch.`;
                return;
            }
            this.emptyState.style.display = 'none';

            const displayByToken = this._displayByToken;
            const tokenFilter = this.tokenselect.value;
            const filtered = tokenFilter
                ? this._records.filter(r => r.token_id === tokenFilter)
                : this._records;

            // Sort reverse-chronologically. Timestamp first (confidential
            // intents rows are off-chain and have no block height), block
            // height as the tiebreaker within a timestamp.
            const sorted = [...filtered].sort((a, b) =>
                (new Date(b.block_timestamp) - new Date(a.block_timestamp))
                || ((b.block_height ?? 0) - (a.block_height ?? 0)));

            const rowTemplate = this.shadowRoot.querySelector('#transactionrowtemplate');

            // Pre-size the scroll container before any rows append so the
            // sticky header doesn't jump as chunks arrive.
            const tableElement = this.shadowRoot.querySelector('.table-responsive');
            tableElement.style.height = (window.innerHeight - tableElement.getBoundingClientRect().top) + 'px';

            // Chunked render: large accounts (20k+ records) would block the
            // main thread for seconds if rendered in one pass. Build chunks
            // off-DOM via DocumentFragment, append, yield to the event loop,
            // repeat. The user sees rows appear progressively and can scroll
            // / switch accounts without waiting for completion.
            const CHUNK_SIZE = 200;
            for (let i = 0; i < sorted.length; i += CHUNK_SIZE) {
                if (!isCurrent()) return;
                const fragment = document.createDocumentFragment();
                const end = Math.min(i + CHUNK_SIZE, sorted.length);
                for (let j = i; j < end; j++) {
                    fragment.appendChild(this._buildRow(sorted[j], displayByToken, rowTemplate));
                }
                this.transactionsTable.appendChild(fragment);

                if (end < sorted.length) {
                    // Yield to the event loop so the browser can paint this
                    // chunk, handle user input (scroll, account-switch click),
                    // and stay responsive.
                    await new Promise(r => setTimeout(r, 0));
                }
            }
        }

        _buildRow(rec, displayByToken, rowTemplate) {
            const row = rowTemplate.content.cloneNode(true).firstElementChild;
            const display = displayByToken.get(rec.token_id);

            const dateString = rec.block_timestamp
                ? new Date(rec.block_timestamp).toJSON().substring(0, 'yyyy-MM-dd HH:mm'.length).replace('T', ' ')
                : '';

            row.querySelector('.txrow_datetime').textContent = dateString;
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
            }
            return row;
        }
    });
