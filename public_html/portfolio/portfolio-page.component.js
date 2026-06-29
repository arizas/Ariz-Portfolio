import { getCurrencyList } from '../pricedata/pricedata.js';
import { calculatePortfolio } from './portfolio-data.js';
import html from './portfolio-page.component.html.js';

const PREFERRED_DEFAULT_CURRENCY = 'nok';

customElements.define('portfolio-page',
    class extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this.shadowRoot.innerHTML = html;
            document.querySelectorAll('link').forEach(lnk => this.shadowRoot.appendChild(lnk.cloneNode()));

            this.progressEl = this.shadowRoot.querySelector('#portfolio-progress');
            this.summaryEl = this.shadowRoot.querySelector('#summary');
            this.holdingsEl = this.shadowRoot.querySelector('#holdings');
            this.excludedNoteEl = this.shadowRoot.querySelector('#excluded-note');
            this.currencySelect = this.shadowRoot.querySelector('#currencyselect');
            this.refreshButton = this.shadowRoot.querySelector('#refreshbutton');

            this.currencySelect.addEventListener('change', () => this.refresh());
            this.refreshButton.addEventListener('click', () => this.refresh());

            this.init();
        }

        async init() {
            const currencies = await getCurrencyList();
            currencies.forEach(currency => {
                const option = document.createElement('option');
                option.value = currency;
                option.text = currency.toUpperCase();
                this.currencySelect.appendChild(option);
            });
            if (currencies.includes(PREFERRED_DEFAULT_CURRENCY)) {
                this.currencySelect.value = PREFERRED_DEFAULT_CURRENCY;
            }
            await this.refresh();
        }

        setBusy(busy, message = '') {
            this.refreshButton.disabled = busy;
            this.currencySelect.disabled = busy;
            this.progressEl.textContent = message;
            this.progressEl.hidden = !busy && !message;
        }

        async refresh() {
            const currency = this.currencySelect.value;
            if (!currency) {
                return;
            }
            this.setBusy(true, 'Laster portefølje …');
            try {
                const portfolio = await calculatePortfolio(currency, msg => this.setBusy(true, msg));
                this.render(portfolio);
                this.setBusy(false, '');
            } catch (e) {
                console.error('Failed to calculate portfolio', e);
                this.setBusy(false, '');
                this.summaryEl.hidden = true;
                this.holdingsEl.innerHTML =
                    `<div class="alert alert-danger">Kunne ikke beregne porteføljen: ${escapeHtml(e.message)}</div>`;
            }
        }

        render(portfolio) {
            const cur = portfolio.currency.toUpperCase();
            const money = makeMoneyFormatter(cur);
            const totalPlClass = portfolio.totalUnrealized >= 0 ? 'gain' : 'loss';
            const pctText = portfolio.totalUnrealizedPct == null
                ? '—'
                : formatSignedPct(portfolio.totalUnrealizedPct);

            // Summary cards
            this.summaryEl.hidden = false;
            this.summaryEl.innerHTML = `
                <div class="summary-card">
                    <div class="label">Total verdi</div>
                    <div class="value">${money(portfolio.totalValue)}</div>
                </div>
                <div class="summary-card">
                    <div class="label">Urealisert gevinst/tap</div>
                    <div class="value ${totalPlClass}">${formatSigned(portfolio.totalUnrealized, money)}</div>
                    <div class="sub ${totalPlClass}">${pctText}</div>
                </div>
                <div class="summary-card">
                    <div class="label">Kostpris</div>
                    <div class="value">${money(portfolio.totalCost)}</div>
                </div>
            `;

            // Holdings
            const maxValue = Math.max(1, ...portfolio.holdings.map(h => h.value ?? 0));
            this.holdingsEl.innerHTML = portfolio.holdings
                .map(h => this.renderHolding(h, money, maxValue))
                .join('');

            // Excluded staking note
            const excludedHoldings = portfolio.holdings.filter(h => h.excluded);
            if (excludedHoldings.length > 0) {
                const names = excludedHoldings.map(h => h.displaySymbol).join(', ');
                this.excludedNoteEl.hidden = false;
                this.excludedNoteEl.innerHTML =
                    `Holdt utenfor totalen (regnes som staking): ${escapeHtml(names)} `
                    + `– verdi ${money(portfolio.excludedValue)}.`;
            } else {
                this.excludedNoteEl.hidden = true;
            }
        }

        renderHolding(h, money, maxValue) {
            const amountText = `${formatTokenAmount(h.amount)} ${escapeHtml(h.symbol)}`;
            const priceText = h.price != null ? `@ ${money(h.price)}` : '';
            const valueText = h.value != null ? money(h.value) : '<span class="muted">verdi ukjent</span>';

            let plText = '';
            if (h.excluded) {
                plText = '<span class="muted">i staking</span>';
            } else if (h.unrealized != null) {
                const cls = h.unrealized >= 0 ? 'gain' : 'loss';
                const pct = h.unrealizedPct == null ? '' : ` (${formatSignedPct(h.unrealizedPct)})`;
                plText = `<span class="${cls}">${formatSigned(h.unrealized, money)}${pct}</span>`;
            } else {
                plText = '<span class="muted">—</span>';
            }

            const flags = [];
            if (h.priceMissing) flags.push('<span class="flag">pris mangler</span>');
            if (h.missingCostBasis) flags.push('<span class="flag">ingen kostpris</span>');
            const flagsHtml = flags.length ? ` ${flags.join(' ')}` : '';

            const barPct = h.value != null && !h.excluded ? Math.round((h.value / maxValue) * 100) : 0;

            return `
                <div class="holding-card${h.excluded ? ' excluded' : ''}">
                    <div>
                        <div class="holding-head">
                            <span class="holding-symbol">${escapeHtml(h.displaySymbol)}</span>${flagsHtml}
                        </div>
                        <div class="holding-amount">${amountText} ${priceText}</div>
                    </div>
                    <div class="holding-values">
                        <div class="holding-value">${valueText}</div>
                        <div class="holding-pl">${plText}</div>
                    </div>
                    <div class="alloc-bar"><span style="width:${barPct}%"></span></div>
                </div>
            `;
        }
    }
);

function makeMoneyFormatter(currencyUpper) {
    // Some "currencies" from the provider are crypto (BTC, ETH) and not valid ISO
    // currency codes, so format as a plain number with the code appended.
    const numberFormatter = new Intl.NumberFormat('nb-NO', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    return (value) => `${numberFormatter.format(value ?? 0)} ${currencyUpper}`;
}

function formatTokenAmount(amount) {
    const abs = Math.abs(amount);
    const maxDecimals = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
    return new Intl.NumberFormat('nb-NO', {
        minimumFractionDigits: 0,
        maximumFractionDigits: maxDecimals
    }).format(amount);
}

function formatSigned(value, money) {
    const sign = value > 0 ? '+' : '';
    return `${sign}${money(value)}`;
}

function formatSignedPct(pct) {
    const sign = pct > 0 ? '+' : '';
    return `${sign}${pct.toFixed(1)} %`;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
