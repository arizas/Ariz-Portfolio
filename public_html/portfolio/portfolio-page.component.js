import { getCurrencyList } from '../pricedata/pricedata.js';
import { calculatePortfolio, calculatePortfolioSeries } from './portfolio-data.js';
import { renderPortfolioChart } from './portfolio-chart.js';
import { groupHoldings, effectivePositions } from './asset-groups.js';
import { computeRisk } from './portfolio-risk.js';
import { getEODPriceMap } from '../pricedata/pricedata.js';
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
            this.topSection = this.shadowRoot.querySelector('#top-section');
            this.summaryEl = this.shadowRoot.querySelector('#summary');
            this.chartPanel = this.shadowRoot.querySelector('#chart-panel');
            this.valueChart = this.shadowRoot.querySelector('#value-chart');
            this.holdingsEl = this.shadowRoot.querySelector('#holdings');
            this.holdingsSection = this.shadowRoot.querySelector('#holdings-section');
            this.concentrationSection = this.shadowRoot.querySelector('#concentration-section');
            this.concentrationEl = this.shadowRoot.querySelector('#concentration');
            this.riskEl = this.shadowRoot.querySelector('#risk');
            // Seam so the risk panel can be tested without OPFS or the network.
            this.__getEODPriceMap = getEODPriceMap;
            this.excludedNoteEl = this.shadowRoot.querySelector('#excluded-note');
            this.currencySelect = this.shadowRoot.querySelector('#currencyselect');
            this.fromMonthSelect = this.shadowRoot.querySelector('#frommonthselect');
            this.fromYearSelect = this.shadowRoot.querySelector('#fromyearselect');
            this.refreshButton = this.shadowRoot.querySelector('#refreshbutton');
            this.granularityButtons = [...this.shadowRoot.querySelectorAll('.granularity button')];

            // Chart resolution — reuses the page's currency + from-date; defaults to monthly.
            this.granularity = 'month';

            this.currencySelect.addEventListener('change', () => this.refresh());
            this.fromMonthSelect.addEventListener('change', () => this.refresh());
            this.fromYearSelect.addEventListener('change', () => this.refresh());
            this.refreshButton.addEventListener('click', () => this.refresh(true));
            this.granularityButtons.forEach(btn => btn.addEventListener('click', () => {
                if (this.granularity === btn.dataset.granularity) return;
                this.granularity = btn.dataset.granularity;
                this.granularityButtons.forEach(b => b.classList.toggle('active', b === btn));
                this.renderChart();
            }));

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
            this.currentCurrency = currency;
            this.currentFromDate = fromDate;
            this.setBusy(true, force ? 'Recalculating portfolio …' : 'Loading portfolio …');
            try {
                const portfolio = await calculatePortfolio(currency, fromDate, msg => this.setBusy(true, msg), { force });
                this.render(portfolio);
                this.setBusy(false, '');
                // Value-over-time chart reuses the (now cached) heavy computation.
                await this.renderChart(force);
                await this.renderRisk(portfolio);
            } catch (e) {
                console.error('Failed to calculate portfolio', e);
                this.setBusy(false, '');
                this.topSection.hidden = false;
                this.summaryEl.hidden = true;
                this.chartPanel.hidden = true;
                this.holdingsSection.hidden = false;
                this.holdingsEl.innerHTML =
                    `<div class="alert alert-danger">Could not calculate portfolio: ${escapeHtml(e.message)}</div>`;
            }
        }

        async renderChart(force = false) {
            if (!this.currentCurrency) {
                return;
            }
            this.topSection.hidden = false;
            this.chartPanel.hidden = false;
            this.valueChart.innerHTML = '<div class="chart-empty">Building value history …</div>';
            try {
                const data = await calculatePortfolioSeries(
                    this.currentCurrency, this.currentFromDate, this.granularity, () => {}, { force });
                const money = makeMoneyFormatter(this.currentCurrency.toUpperCase());
                renderPortfolioChart(this.valueChart, data, { formatMoney: money, formatDate: formatDate });
            } catch (e) {
                console.error('Failed to build value history', e);
                this.valueChart.innerHTML = '<div class="chart-empty">Could not load value history.</div>';
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

            this.topSection.hidden = false;
            this.summaryEl.hidden = false;
            this.summaryEl.innerHTML = `
                ${portfolio.pricesUnavailable ? `
                <div class="card-surface price-warning" role="alert">
                    ⚠ Couldn't reach the price service, so current values are unavailable.
                    Cost basis and realized P/L below are from cached price history.
                    Try <strong>Refresh</strong> in a moment.
                </div>` : ''}
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

            this.renderConcentration(portfolio, money);

            // Holdings (liquid), with a dedicated staked row on top when present.
            this.holdingsSection.hidden = false;
            const maxValue = Math.max(1, ...portfolio.holdings.map(h => h.value ?? 0));
            const stakedUnrealizedHtml = portfolio.stakedUnrealized != null
                ? `<span class="${portfolio.stakedUnrealized >= 0 ? 'gain' : 'loss'}">${formatSigned(portfolio.stakedUnrealized, money)}</span>`
                : '<span class="muted">not realized</span>';
            const stakedRow = hasStaking ? `
                <div class="holding-card">
                    <div>
                        <div class="holding-head">
                            <span class="holding-symbol">NEAR — staked</span>
                            <span class="flag">staking</span>
                        </div>
                        <div class="holding-amount">${formatTokenAmount(portfolio.stakedAmount)} NEAR ${portfolio.stakedValue != null ? `@ ${money(portfolio.stakedValue / portfolio.stakedAmount)}` : ''}</div>
                        ${portfolio.stakedCostBasis > 0 ? `<div class="holding-amount">Cost basis: ${money(portfolio.stakedCostBasis)}</div>` : ''}
                    </div>
                    <div class="holding-values">
                        <div class="holding-value">${portfolio.stakedValue != null ? money(portfolio.stakedValue) : '<span class="muted">value unknown</span>'}</div>
                        <div class="holding-pl">${stakedUnrealizedHtml}</div>
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

        // Concentration by economic asset. The holdings table below lists one row
        // per token, which is right for cost basis and wrong for exposure: NEAR,
        // wNEAR, stNEAR and staked NEAR are four rows and one position.
        renderConcentration(portfolio, money) {
            const { groups, total, unpriced, herfindahl } = groupHoldings(portfolio);
            if (!groups.length) {
                this.concentrationSection.hidden = true;
                return;
            }
            this.concentrationSection.hidden = false;
            const effective = effectivePositions(herfindahl);
            const top = groups[0];
            const rows = groups.map(g => {
                const members = g.members.length > 1
                    ? `<span class="conc-members">${escapeHtml(g.members.map(m => m.displaySymbol).join(' + '))}</span>`
                    : '';
                return `
                <div class="conc-row">
                    <div class="conc-name">${escapeHtml(g.asset)}${members ? `<br>${members}` : ''}</div>
                    <div class="conc-track"><div class="conc-fill" style="width:${(g.weight * 100).toFixed(1)}%"></div></div>
                    <div class="conc-pct">${(g.weight * 100).toFixed(1)}%</div>
                    <div class="conc-val">${money(g.value)}</div>
                </div>`;
            }).join('');
            // The hero total deliberately leaves liquid-staking tokens out (they are
            // reported against the staking line instead), so this panel's total is
            // larger. Say so rather than leaving two different totals on one page.
            const excluded = (portfolio.holdings ?? []).filter(h => h.excluded && h.value > 0);
            const excludedNote = excluded.length
                ? `<div class="footnote">This total is ${money(excluded.reduce((a, h) => a + h.value, 0))} higher than `
                    + `<em>Total value now</em> above, which reports `
                    + `${escapeHtml(excluded.map(h => h.displaySymbol).join(', '))} against the staking line instead of in the total.</div>`
                : '';
            const unpricedNote = unpriced.length
                ? `<div class="footnote">No current price, so left out of the weights: `
                    + `${escapeHtml(unpriced.map(u => u.displaySymbol).join(', '))}.</div>`
                : '';
            this.concentrationEl.innerHTML = `
                <div style="padding:0.9rem 1.1rem">
                    <div class="conc-head">
                        <span class="value">${escapeHtml(top.asset)} ${(top.weight * 100).toFixed(1)}%</span>
                        <span class="cap">largest exposure · ${effective != null ? `equivalent to ${effective.toFixed(1)} equally weighted position${effective.toFixed(1) === '1.0' ? '' : 's'}` : ''} · ${money(total)} total</span>
                    </div>
                    ${rows}
                    ${excludedNote}
                    ${unpricedNote}
                    <div class="footnote">
                        Grouped by economic asset, so a wrapper or liquid-staking token counts as its
                        underlying and staked NEAR counts as NEAR. The holdings list below stays per token,
                        because cost basis and tax follow the token, not the exposure.
                    </div>
                </div>`;
        }

        // What the concentration costs in risk terms. Async because it needs a
        // price series per exposure; failures are silent-but-visible (the block
        // simply stays hidden) since this is context, not a number the page owes.
        async renderRisk(portfolio) {
            const { groups } = groupHoldings(portfolio);
            if (groups.length < 1) { this.riskEl.hidden = true; return; }
            const currency = portfolio.currency;

            const series = new Map();
            await Promise.all(groups.map(async g => {
                // Price the exposure by its economic symbol — the same key
                // calculatePortfolio prices holdings with. Going via one member's
                // token id would take a different resolution path for no gain.
                try {
                    const map = await this.__getEODPriceMap(currency, g.asset);
                    if (map && Object.keys(map).some(k => /^\d{4}-/.test(k))) series.set(g.asset, map);
                } catch { /* leave it out; computeRisk reports what it omitted */ }
            }));

            const risk = computeRisk(groups, series);
            this.riskEl.hidden = false;
            if (!risk.ok) {
                // Say why rather than vanish: a panel that silently disappears is
                // indistinguishable from one that is broken.
                const why = {
                    'no-material-positions': 'every position is too small to affect portfolio volatility',
                    'no-price-history': 'no daily price history for the positions that matter',
                    'insufficient-overlap': `only ${risk.observations} days of price history overlap across your positions`,
                }[risk.reason] ?? risk.reason;
                this.riskEl.innerHTML = `
                    <div class="risk-body">
                        <div class="section-label" style="margin-top:0">Risk · what this mix has swung by</div>
                        <div class="footnote" style="margin-top:0">
                            Not calculated — ${escapeHtml(why)}.
                            ${this.omittedNote(risk)}
                        </div>
                    </div>`;
                return;
            }

            // Never round a share up to 100 %: the other positions do contribute,
            // and "100 % of the risk" would be a false statement about them.
            const pct = (v, d = 0) => {
                let shown = (v * 100).toFixed(d);
                // A share below 1 must never round up to 100 %: the other positions
                // do contribute, and "100 % of the risk" would be false about them.
                if (v < 1 && Number(shown) >= 100) shown = (100 - 10 ** -d).toFixed(d);
                return `${shown}\u00a0%`;
            };
            const top = [...risk.assets].sort((a, b) => b.riskShare - a.riskShare)[0];
            const diversified = risk.diversification != null && risk.diversification > 1.02
                ? `Holding them together removes <strong>${pct(1 - 1 / risk.diversification)}</strong> of the volatility you would carry holding each on its own.`
                : `Holding them together removes <strong>almost none</strong> of the volatility you would carry holding each on its own.`;
            const concentrationLine = risk.assets.length > 1
                ? `<strong>${escapeHtml(top.asset)}</strong> accounts for <strong>${pct(top.riskShare, 1)}</strong> of that risk on ${pct(top.weight, 1)} of the money. `
                : '';

            const curve = risk.curve.length > 1 ? `
                <div class="risk-curve">
                    ${risk.curve.slice(1).map(pt => `
                        <span class="cut">${escapeHtml(top.asset)} at ${pct(pt.weight)}</span>
                        <span class="arrow">&rarr;</span>
                        <span>${pct(pt.vol)} per year</span>
                    `).join('')}
                </div>
                <div class="footnote">
                    What the same money would have swung by at other weights, spreading the
                    difference across everything else you hold. A description of the past,
                    not a projection — and it says nothing about return.
                </div>` : '';

            this.riskEl.innerHTML = `
                <div class="risk-body">
                    <div class="section-label" style="margin-top:0">Risk · what this mix has swung by</div>
                    <div class="risk-lead">
                        Portfolio volatility <strong>${pct(risk.portfolioVol)} per year</strong>.
                        ${concentrationLine}${diversified}
                    </div>
                    ${curve}
                    <div class="footnote">
                        ${risk.observations} daily closes, ${escapeHtml(risk.from)} to ${escapeHtml(risk.to)}, annualised on calendar time.
                        ${this.omittedNote(risk)}
                        ${risk.dust?.length ? `Positions too small to affect the result are excluded: ${escapeHtml(risk.dust.join(', '))}.` : ''}
                    </div>
                </div>`;
        }

        // Name what was left out and why. "No usable price history" hides two
        // different situations: nothing at all, versus a series too short to
        // measure. Only the second means "wait for the backfill".
        omittedNote(risk) {
            if (!risk.omitted?.length) return '';
            const none = risk.omitted.filter(o => o.reason === 'no-history').map(o => o.asset);
            const short = risk.omitted.filter(o => o.reason === 'short-history');
            const parts = [];
            if (none.length) {
                parts.push(`No price history for ${escapeHtml(none.join(', '))}, so ${none.length > 1 ? 'they are' : 'it is'} left out.`);
            }
            for (const o of short) {
                parts.push(`${escapeHtml(o.asset)} has only ${o.observations} day${o.observations === 1 ? '' : 's'} `
                    + `of price history and needs ${risk.required}, so it is left out.`);
            }
            return parts.join(' ');
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
