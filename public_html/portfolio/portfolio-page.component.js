import { getCurrencyList } from '../pricedata/pricedata.js';
import { calculatePortfolio } from './portfolio-data.js';
import html from './portfolio-page.component.html.js';

const PREFERRED_DEFAULT_CURRENCY = 'nok';

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

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
            this.holdingsSection = this.shadowRoot.querySelector('#holdings-section');
            this.excludedNoteEl = this.shadowRoot.querySelector('#excluded-note');
            this.currencySelect = this.shadowRoot.querySelector('#currencyselect');
            this.fromMonthSelect = this.shadowRoot.querySelector('#frommonthselect');
            this.fromYearSelect = this.shadowRoot.querySelector('#fromyearselect');
            this.refreshButton = this.shadowRoot.querySelector('#refreshbutton');

            this.currencySelect.addEventListener('change', () => this.refresh());
            this.fromMonthSelect.addEventListener('change', () => this.refresh());
            this.fromYearSelect.addEventListener('change', () => this.refresh());
            this.refreshButton.addEventListener('click', () => this.refresh(true));

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

            // "From" date selectors: start of the fiscal period (IB date).
            MONTH_NAMES.forEach((name, idx) => {
                const opt = document.createElement('option');
                opt.value = String(idx);
                opt.text = name;
                this.fromMonthSelect.appendChild(opt);
            });
            const currentYear = new Date().getFullYear();
            for (let year = currentYear; year >= 2020; year--) {
                const opt = document.createElement('option');
                opt.value = String(year);
                opt.text = String(year);
                this.fromYearSelect.appendChild(opt);
            }
            // Default to the start of the current calendar/fiscal year.
            this.fromMonthSelect.value = '0';
            this.fromYearSelect.value = String(currentYear);

            await this.refresh();
        }

        getFromDate() {
            const year = parseInt(this.fromYearSelect.value, 10);
            const month = parseInt(this.fromMonthSelect.value, 10);
            const mm = String(month + 1).padStart(2, '0');
            return `${year}-${mm}-01`;
        }

        setBusy(busy, message = '') {
            this.refreshButton.disabled = busy;
            this.currencySelect.disabled = busy;
            this.progressEl.textContent = message;
            this.progressEl.hidden = !busy && !message;
        }

        async refresh(force = false) {
            const currency = this.currencySelect.value;
            if (!currency) {
                return;
            }
            const fromDate = this.getFromDate();
            this.setBusy(true, force ? 'Recalculating portfolio …' : 'Loading portfolio …');
            try {
                const portfolio = await calculatePortfolio(currency, fromDate, msg => this.setBusy(true, msg), { force });
                this.render(portfolio);
                this.setBusy(false, '');
            } catch (e) {
                console.error('Failed to calculate portfolio', e);
                this.setBusy(false, '');
                this.summaryEl.hidden = true;
                this.holdingsSection.hidden = false;
                this.holdingsEl.innerHTML =
                    `<div class="alert alert-danger">Could not calculate portfolio: ${escapeHtml(e.message)}</div>`;
            }
        }

        render(portfolio) {
            const cur = portfolio.currency.toUpperCase();
            const money = makeMoneyFormatter(cur);
            const fromLabel = formatDate(portfolio.fromDate);
            const realizedClass = portfolio.totalRealized >= 0 ? 'gain' : 'loss';
            const unrealClass = portfolio.totalUnrealized >= 0 ? 'gain' : 'loss';
            const resultClass = portfolio.totalResult >= 0 ? 'gain' : 'loss';
            const pctText = portfolio.totalUnrealizedPct == null ? '' : formatSignedPct(portfolio.totalUnrealizedPct);

            const hasStaking = portfolio.stakedAmount > 1e-9;
            const totalNow = hasStaking ? portfolio.totalWithStaked : portfolio.totalValue;
            const openingNow = hasStaking ? portfolio.ibWithStaked : portfolio.ibValue;

            // In a non-USD currency the unrealized P/L also carries currency (FX)
            // effects on USD-denominated assets, so it isn't a plain FX multiple of
            // the USD figure. Make that explicit.
            const unrealCap = cur === 'USD'
                ? 'market change on current holdings'
                : `market change · incl. currency (FX) effects in ${cur}`;

            const heroSub = hasStaking
                ? `<div class="hero-sub">${money(portfolio.totalValue)} liquid <span class="muted">+</span> ${money(portfolio.stakedValue || 0)} staked <span class="muted">(${formatTokenAmount(portfolio.stakedAmount)} NEAR)</span></div>`
                : '';

            this.summaryEl.hidden = false;
            this.summaryEl.innerHTML = `
                <div class="card-surface hero-card">
                    <div class="label">Total value now ${hasStaking ? '<span class="muted">(incl. staked)</span>' : ''}</div>
                    <div class="hero-value">${money(totalNow)}</div>
                    ${heroSub}
                </div>

                <div class="section-label">Result this fiscal year · since ${escapeHtml(fromLabel)}</div>
                <div class="result-grid">
                    <div class="card-surface metric-card">
                        <div class="label">Realized</div>
                        <div class="value ${realizedClass}">${formatSigned(portfolio.totalRealized, money)}</div>
                        <div class="cap">swaps and sales · net of fees and slippage</div>
                    </div>
                    <div class="card-surface metric-card">
                        <div class="label">Unrealized</div>
                        <div class="value ${unrealClass}">${formatSigned(portfolio.totalUnrealized, money)}${pctText ? ` <span class="metric-pct ${unrealClass}">${pctText}</span>` : ''}</div>
                        <div class="cap">${unrealCap}</div>
                    </div>
                    <div class="card-surface metric-card result">
                        <div class="label ${resultClass}">= Result</div>
                        <div class="value ${resultClass}">${formatSigned(portfolio.totalResult, money)}</div>
                        <div class="cap ${resultClass}">realized + unrealized</div>
                    </div>
                </div>
                <div class="footnote">Realized is net of gas, fees and slippage — every swap counts as a disposal (FIFO). Verify before reporting.</div>

                <div class="section-label">Balance</div>
                <div class="card-surface balance-card">
                    <div>
                        <div class="label">Opening · ${escapeHtml(fromLabel)}</div>
                        <div class="bal-value">${money(openingNow)}</div>
                    </div>
                    <div class="bal-arrow">&rarr;</div>
                    <div>
                        <div class="label">Now${hasStaking ? ' · incl. staked' : ''}</div>
                        <div class="bal-value">${money(totalNow)}</div>
                    </div>
                </div>
            `;

            // Holdings (liquid), with a dedicated staked row on top when present.
            this.holdingsSection.hidden = false;
            const maxValue = Math.max(1, ...portfolio.holdings.map(h => h.value ?? 0));
            const stakedRow = hasStaking ? `
                <div class="holding-card">
                    <div>
                        <div class="holding-head">
                            <span class="holding-symbol">NEAR — staked</span>
                            <span class="flag">staking</span>
                        </div>
                        <div class="holding-amount">${formatTokenAmount(portfolio.stakedAmount)} NEAR ${portfolio.stakedValue != null ? `@ ${money(portfolio.stakedValue / portfolio.stakedAmount)}` : ''}</div>
                    </div>
                    <div class="holding-values">
                        <div class="holding-value">${portfolio.stakedValue != null ? money(portfolio.stakedValue) : '<span class="muted">value unknown</span>'}</div>
                        <div class="holding-pl"><span class="muted">not realized</span></div>
                    </div>
                </div>
            ` : '';
            this.holdingsEl.innerHTML = stakedRow + portfolio.holdings
                .map(h => this.renderHolding(h, money, maxValue))
                .join('');

            // Excluded staking note
            const excludedHoldings = portfolio.holdings.filter(h => h.excluded);
            if (excludedHoldings.length > 0) {
                const names = excludedHoldings.map(h => h.displaySymbol).join(', ');
                this.excludedNoteEl.hidden = false;
                this.excludedNoteEl.innerHTML =
                    `Excluded from total (treated as staking): ${escapeHtml(names)} `
                    + `– value ${money(portfolio.excludedValue)}.`;
            } else {
                this.excludedNoteEl.hidden = true;
            }
        }

        renderHolding(h, money, maxValue) {
            const amountText = `${formatTokenAmount(h.amount)} ${escapeHtml(h.symbol)}`;
            const priceText = h.price != null ? `@ ${money(h.price)}` : '';
            const valueText = h.value != null ? money(h.value) : '<span class="muted">value unknown</span>';

            let plText = '';
            if (h.excluded) {
                plText = '<span class="muted">staking</span>';
            } else if (h.unrealized != null) {
                const cls = h.unrealized >= 0 ? 'gain' : 'loss';
                const pct = h.unrealizedPct == null ? '' : ` (${formatSignedPct(h.unrealizedPct)})`;
                plText = `<span class="${cls}">${formatSigned(h.unrealized, money)}${pct}</span>`;
            } else {
                plText = '<span class="muted">—</span>';
            }

            // Realized (period) line — only when there is something realized.
            let realizedText = '';
            if (!h.excluded && Math.abs(h.realized) > 1e-9) {
                const cls = h.realized >= 0 ? 'gain' : 'loss';
                realizedText = `<div class="holding-pl">Realized: <span class="${cls}">${formatSigned(h.realized, money)}</span></div>`;
            }

            // Opening balance line — only when there was an opening balance for this token.
            let ibText = '';
            if (h.ibAmount > 1e-9) {
                const ibVal = h.ibValue != null ? money(h.ibValue) : '–';
                ibText = `<div class="holding-amount">Opening: ${ibVal}</div>`;
            }

            const flags = [];
            if (h.priceMissing) flags.push('<span class="flag">no price</span>');
            if (h.missingCostBasis) flags.push('<span class="flag">no cost basis</span>');
            const flagsHtml = flags.length ? ` ${flags.join(' ')}` : '';

            const barPct = h.value != null && !h.excluded ? Math.round((h.value / maxValue) * 100) : 0;

            return `
                <div class="holding-card${h.excluded ? ' excluded' : ''}">
                    <div>
                        <div class="holding-head">
                            <span class="holding-symbol">${escapeHtml(h.displaySymbol)}</span>${flagsHtml}
                        </div>
                        <div class="holding-amount">${amountText} ${priceText}</div>
                        ${ibText}
                    </div>
                    <div class="holding-values">
                        <div class="holding-value">${valueText}</div>
                        <div class="holding-pl">${plText}</div>
                        ${realizedText}
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
    // Follow the app-wide convention of using the browser locale for numbers.
    const numberFormatter = new Intl.NumberFormat(navigator.language, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    return (value) => `${numberFormatter.format(value ?? 0)} ${currencyUpper}`;
}

function formatTokenAmount(amount) {
    const abs = Math.abs(amount);
    const maxDecimals = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
    return new Intl.NumberFormat(navigator.language, {
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

function formatDate(isoDate) {
    // 'yyyy-MM-dd' -> 'dd.MM.yyyy'
    const [y, m, d] = String(isoDate).split('-');
    return `${d}.${m}.${y}`;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
