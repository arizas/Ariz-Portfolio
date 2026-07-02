// Zero-dependency stacked-area ("wave") chart for the portfolio value over time.
//
// Renders total portfolio value as two stacked bands - liquid (bottom) and staked
// (top) - in plain SVG, with axes, gridlines and a hover crosshair + tooltip.
// No external charting library.

const LIQUID_STROKE = '#2a78d6';
const LIQUID_FILL = 'rgba(42, 120, 214, 0.13)';
const STAKED_STROKE = '#1baf7a';
const STAKED_FILL = 'rgba(27, 175, 122, 0.18)';

// viewBox geometry (SVG scales to container width; these are internal units)
const W = 640, H = 260;
const M = { left: 58, right: 16, top: 12, bottom: 26 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

function compact(v) {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return Math.round(v / 1e3) + 'k';
    return String(Math.round(v));
}

// A "nice" axis maximum at or above value (1/2/2.5/5 * 10^n).
function niceMax(value) {
    if (value <= 0) return 1;
    const exp = Math.floor(Math.log10(value));
    const base = Math.pow(10, exp);
    const f = value / base;
    const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return nice * base;
}

function defaultDateShort(iso, granularity) {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    // Axis labels are always English (like the rest of the portfolio UI), day-first.
    if (granularity === 'month') {
        return date.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
    }
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
}

function xForIndex(i, n) {
    if (n <= 1) return M.left + PLOT_W / 2;
    return M.left + (i / (n - 1)) * PLOT_W;
}

/**
 * Render the value-over-time chart into a container element.
 * @param {HTMLElement} container
 * @param {{series:{date:string,liquid:number,staked:number,total:number}[], currency:string, granularity:string}} data
 * @param {{formatMoney?:(v:number)=>string, formatDate?:(iso:string)=>string}} [opts]
 */
export function renderPortfolioChart(container, data, opts = {}) {
    const series = data.series || [];
    const granularity = data.granularity || 'month';
    const money = opts.formatMoney || ((v) => String(Math.round(v)));
    const dateLong = opts.formatDate || ((iso) => iso);
    const dateShort = (iso) => defaultDateShort(iso, granularity);

    const maxTotal = Math.max(0, ...series.map(p => p.total));

    if (!series.length || maxTotal <= 0) {
        container.innerHTML =
            `<div class="chart-empty">No value history to show for this period.</div>`;
        return;
    }

    const n = series.length;
    const yMax = niceMax(maxTotal);
    const y = (v) => M.top + PLOT_H - (v / yMax) * PLOT_H;
    const x = (i) => xForIndex(i, n);

    // Staked band: baseline -> staked line (bottom). Liquid band: staked line -> total line (top).
    const baseY = M.top + PLOT_H;
    const stakedTop = series.map((p, i) => `${x(i).toFixed(1)},${y(p.staked).toFixed(1)}`);
    const totalTop = series.map((p, i) => `${x(i).toFixed(1)},${y(p.total).toFixed(1)}`);

    const stakedArea =
        `M ${x(0).toFixed(1)},${baseY.toFixed(1)} `
        + `L ${stakedTop.join(' L ')} `
        + `L ${x(n - 1).toFixed(1)},${baseY.toFixed(1)} Z`;

    const liquidArea =
        `M ${stakedTop.join(' L ')} `
        + `L ${[...totalTop].reverse().join(' L ')} Z`;

    const stakedLine = `M ${stakedTop.join(' L ')}`;
    const totalLine = `M ${totalTop.join(' L ')}`;

    // Gridlines + y labels (4 steps).
    const gridSteps = 4;
    let grid = '';
    for (let s = 0; s <= gridSteps; s++) {
        const val = (yMax / gridSteps) * s;
        const gy = y(val);
        grid += `<line class="grid" x1="${M.left}" y1="${gy.toFixed(1)}" x2="${(W - M.right)}" y2="${gy.toFixed(1)}"/>`;
        grid += `<text class="axis y" x="${M.left - 8}" y="${(gy + 3.5).toFixed(1)}" text-anchor="end">${compact(val)}</text>`;
    }

    // X labels: up to ~6 evenly spaced.
    const maxLabels = 6;
    const stepIdx = Math.max(1, Math.ceil(n / maxLabels));
    let xlabels = '';
    for (let i = 0; i < n; i += stepIdx) {
        xlabels += `<text class="axis x" x="${x(i).toFixed(1)}" y="${(H - 8)}" text-anchor="middle">${dateShort(series[i].date)}</text>`;
    }
    // Always label the final point.
    if ((n - 1) % stepIdx !== 0) {
        xlabels += `<text class="axis x" x="${x(n - 1).toFixed(1)}" y="${(H - 8)}" text-anchor="middle">${dateShort(series[n - 1].date)}</text>`;
    }

    container.innerHTML = `
        <svg class="value-chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
             role="img" aria-label="Portfolio value over time, liquid and staked, stacked">
            <style>
                .value-chart-svg { width: 100%; height: 100%; display: block; }
                .value-chart-svg .grid { stroke: #e9ecef; stroke-width: 1; }
                .value-chart-svg .axis { fill: #6c757d; font-size: 11px; font-family: inherit; }
                .value-chart-svg .cross { stroke: #adb5bd; stroke-width: 1; stroke-dasharray: 3 3; }
                @media (prefers-color-scheme: dark) {
                    .value-chart-svg .grid { stroke: #2c2c2a; }
                    .value-chart-svg .axis { fill: #9a9a94; }
                    .value-chart-svg .cross { stroke: #6c6c68; }
                }
            </style>
            ${grid}
            <path d="${stakedArea}" fill="${STAKED_FILL}"/>
            <path d="${liquidArea}" fill="${LIQUID_FILL}"/>
            <path d="${stakedLine}" fill="none" stroke="${STAKED_STROKE}" stroke-width="2" stroke-linejoin="round"/>
            <path d="${totalLine}" fill="none" stroke="${LIQUID_STROKE}" stroke-width="2" stroke-linejoin="round"/>
            ${xlabels}
            <line class="cross" x1="0" y1="${M.top}" x2="0" y2="${baseY}" style="display:none"/>
            <circle class="dot-liquid" r="3.5" fill="${LIQUID_STROKE}" style="display:none"/>
            <circle class="dot-total" r="3.5" fill="${STAKED_STROKE}" style="display:none"/>
            <rect class="hover-overlay" x="${M.left}" y="${M.top}" width="${PLOT_W}" height="${PLOT_H}"
                  fill="transparent" style="cursor:crosshair"/>
        </svg>
        <div class="chart-tooltip" hidden></div>
    `;

    const svg = container.querySelector('svg');
    const overlay = container.querySelector('.hover-overlay');
    const cross = container.querySelector('.cross');
    const dotL = container.querySelector('.dot-liquid');
    const dotT = container.querySelector('.dot-total');
    const tooltip = container.querySelector('.chart-tooltip');

    function showAt(i) {
        const p = series[i];
        const px = x(i);
        cross.setAttribute('x1', px);
        cross.setAttribute('x2', px);
        cross.style.display = '';
        // Blue dot on the top (liquid) line; green dot on the staked boundary.
        dotL.setAttribute('cx', px); dotL.setAttribute('cy', y(p.total)); dotL.style.display = '';
        dotT.setAttribute('cx', px); dotT.setAttribute('cy', y(p.staked)); dotT.style.display = p.staked > 0 ? '' : 'none';

        tooltip.hidden = false;
        tooltip.innerHTML =
            `<div class="tt-date">${dateLong(p.date)}</div>`
            + `<div class="tt-row"><span class="tt-key"><i style="background:${STAKED_STROKE}"></i>Total</span><span class="tt-val">${money(p.total)}</span></div>`
            + `<div class="tt-row"><span class="tt-key"><i style="background:${LIQUID_STROKE}"></i>Liquid</span><span class="tt-val">${money(p.liquid)}</span></div>`
            + (p.staked > 0 ? `<div class="tt-row"><span class="tt-key"><i style="background:${STAKED_STROKE}"></i>Staked</span><span class="tt-val">${money(p.staked)}</span></div>` : '');

        // Position tooltip in pixel space near the point, kept inside the container.
        const cRect = container.getBoundingClientRect();
        const sRect = svg.getBoundingClientRect();
        const pxPixel = sRect.left - cRect.left + (px / W) * sRect.width;
        let left = pxPixel + 12;
        const ttW = tooltip.offsetWidth || 140;
        if (left + ttW > cRect.width) left = pxPixel - ttW - 12;
        if (left < 0) left = 4;
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `4px`;
    }

    function hide() {
        cross.style.display = 'none';
        dotL.style.display = 'none';
        dotT.style.display = 'none';
        tooltip.hidden = true;
    }

    function indexFromEvent(evt) {
        const rect = overlay.getBoundingClientRect();
        const frac = Math.min(1, Math.max(0, (evt.clientX - rect.left) / rect.width));
        return Math.round(frac * (n - 1));
    }

    overlay.addEventListener('mousemove', (e) => showAt(indexFromEvent(e)));
    overlay.addEventListener('mouseleave', hide);
    overlay.addEventListener('touchstart', (e) => { if (e.touches[0]) showAt(indexFromEvent(e.touches[0])); }, { passive: true });
    overlay.addEventListener('touchmove', (e) => { if (e.touches[0]) showAt(indexFromEvent(e.touches[0])); }, { passive: true });
}
