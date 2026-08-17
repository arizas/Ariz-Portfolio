// What the current mix costs in risk terms.
//
// Pure: takes the groups from asset-groups.js plus a daily price series per
// group, and returns volatility, risk contributions and the curve of portfolio
// volatility as the largest position is reduced. No I/O — the caller fetches
// the series (getEODPriceMap) and decides which member's price represents a
// group.
//
// Nothing here forecasts anything. Volatility and correlation are descriptions
// of the past that happen to be far more stable than returns are; they are used
// to price the concentration you already have, not to suggest a trade.

const MIN_OBSERVATIONS = 60;

/**
 * Annualise a per-observation standard deviation using CALENDAR time.
 *
 * Price history has gaps — a series of 365 observations routinely spans 400+
 * days — so scaling by sqrt(365) overstates volatility by the square root of
 * the gap ratio. Scale by observations per calendar year instead.
 */
export function annualisationFactor(dates) {
    if (dates.length < 2) return 0;
    const first = Date.parse(`${dates[0]}T00:00:00Z`);
    const last = Date.parse(`${dates[dates.length - 1]}T00:00:00Z`);
    const years = (last - first) / 86400000 / 365.25;
    if (!(years > 0)) return 0;
    return Math.sqrt(dates.length / years);
}

function mean(xs) {
    let s = 0;
    for (const x of xs) s += x;
    return xs.length ? s / xs.length : NaN;
}

/** Sample standard deviation (n-1). */
export function stdev(xs) {
    if (xs.length < 2) return NaN;
    const m = mean(xs);
    let s = 0;
    for (const x of xs) s += (x - m) ** 2;
    return Math.sqrt(s / (xs.length - 1));
}

/** Pearson correlation. */
export function correlation(xs, ys) {
    if (xs.length !== ys.length || xs.length < 2) return NaN;
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < xs.length; i++) {
        const dx = xs[i] - mx, dy = ys[i] - my;
        sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

/** Log returns between consecutive observations. */
export function logReturns(prices) {
    const out = [];
    for (let i = 1; i < prices.length; i++) {
        if (prices[i] > 0 && prices[i - 1] > 0) out.push(Math.log(prices[i] / prices[i - 1]));
    }
    return out;
}

/**
 * Dates every series has a positive price for, most recent `limit` first-to-last.
 * @param {Map<string, object>} seriesByAsset asset -> { 'YYYY-MM-DD': price }
 */
export function commonDates(seriesByAsset, limit = 365) {
    const maps = [...seriesByAsset.values()];
    if (!maps.length) return [];
    const [first, ...rest] = maps;
    const dates = Object.keys(first)
        .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && first[d] > 0 && rest.every(m => m[d] > 0))
        .sort();
    return dates.slice(-limit);
}

/**
 * Volatility, correlation and risk contribution for a grouped portfolio.
 *
 * @param {Array<{asset: string, weight: number}>} groups from groupHoldings
 * @param {Map<string, object>} seriesByAsset asset -> daily price map
 * @param {{lookback?: number, minWeight?: number}} [options]
 * @returns {{ok: true, ...}|{ok: false, reason: string, ...}}
 *   Always returns a result. When it cannot compute it says why, because a
 *   panel that silently disappears is indistinguishable from one that is broken.
 */
export function computeRisk(groups, seriesByAsset, { lookback = 365, minWeight = 0.001 } = {}) {
    const held = groups.filter(g => g.weight > 0);

    // Dust is excluded before anything else. The floor is 0.1 %, which lines up
    // with what the panel renders as "0.0 %" — so anything shown as zero is
    // exactly what is left out here. Such a position cannot move portfolio
    // volatility, and — the reason this matters rather than being a nicety — a
    // single sparsely priced dust token would otherwise collapse the
    // common-date intersection below and take the whole calculation with it.
    const dust = held.filter(g => g.weight < minWeight).map(g => g.asset);
    const material = held.filter(g => g.weight >= minWeight);
    if (!material.length) return { ok: false, reason: 'no-material-positions', dust, omitted: [] };

    // Omissions carry their reason and their count. "No usable price history"
    // covers two quite different situations — nothing at all, versus a series
    // too short to measure — and only the second one tells you to wait for a
    // backfill rather than go looking for a broken price lookup.
    const omitted = material
        .filter(g => !seriesByAsset.has(g.asset))
        .map(g => ({ asset: g.asset, reason: 'no-history', observations: 0 }));

    // Drop anything whose own history is too short before intersecting: one
    // asset listed last month must not shorten the window for everything else.
    const usable = material.filter(g => {
        if (!seriesByAsset.has(g.asset)) return false;
        const own = commonDates(new Map([[g.asset, seriesByAsset.get(g.asset)]]), lookback);
        if (own.length >= MIN_OBSERVATIONS) return true;
        omitted.push({ asset: g.asset, reason: 'short-history', observations: own.length });
        return false;
    });
    if (!usable.length) return { ok: false, reason: 'no-price-history', omitted, dust };

    const subset = new Map(usable.map(g => [g.asset, seriesByAsset.get(g.asset)]));
    const dates = commonDates(subset, lookback);
    if (dates.length < MIN_OBSERVATIONS) {
        return { ok: false, reason: 'insufficient-overlap', observations: dates.length, omitted, dust, required: MIN_OBSERVATIONS };
    }

    const factor = annualisationFactor(dates);
    const returns = usable.map(g => logReturns(dates.map(d => subset.get(g.asset)[d])));
    const vols = returns.map(r => stdev(r) * factor);

    // Renormalise across what is actually measured, so the portfolio figure is
    // internally consistent even when something was left out.
    const totalWeight = usable.reduce((a, g) => a + g.weight, 0);
    const w = usable.map(g => g.weight / totalWeight);

    const n = usable.length;
    const cov = (i, j) => (i === j ? vols[i] ** 2 : correlation(returns[i], returns[j]) * vols[i] * vols[j]);

    let variance = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) variance += w[i] * w[j] * cov(i, j);
    const portfolioVol = Math.sqrt(Math.max(variance, 0));

    // Euler risk contribution: w_i * (Sigma w)_i / sigma_p. These sum to sigma_p,
    // so the shares sum to 1 — the honest way to say "NEAR is 99 % of your risk".
    const assets = usable.map((g, i) => {
        let marginal = 0;
        for (let j = 0; j < n; j++) marginal += w[j] * cov(i, j);
        const contribution = portfolioVol > 0 ? (w[i] * marginal) / portfolioVol : 0;
        return {
            asset: g.asset,
            weight: w[i],
            vol: vols[i],
            riskShare: portfolioVol > 0 ? contribution / portfolioVol : 0,
        };
    });

    const weightedAvgVol = w.reduce((a, wi, i) => a + wi * vols[i], 0);

    return {
        ok: true,
        assets,
        portfolioVol,
        weightedAvgVol,
        // 1.0 means the mix removes no risk at all; higher is more diversified.
        diversification: portfolioVol > 0 ? weightedAvgVol / portfolioVol : null,
        observations: dates.length,
        from: dates[0],
        to: dates[dates.length - 1],
        omitted,
        dust,
        required: MIN_OBSERVATIONS,
        curve: reductionCurve(w, vols, cov, n),
    };
}

/**
 * Portfolio volatility as the largest position is reduced and the proceeds are
 * spread pro rata over the others. Answers "what would moving 10 % buy" without
 * suggesting that it should be moved.
 */
function reductionCurve(w, vols, cov, n) {
    if (n < 2) return [];
    let top = 0;
    for (let i = 1; i < n; i++) if (w[i] > w[top]) top = i;
    const restTotal = w.reduce((a, wi, i) => a + (i === top ? 0 : wi), 0);
    if (!(restTotal > 0)) return [];

    const points = [];
    for (let cut = 0; cut <= 0.6001; cut += 0.1) {
        const target = w[top] - cut;
        if (target < 0) break;
        const weights = w.map((wi, i) => (i === top ? target : wi + cut * (wi / restTotal)));
        let v = 0;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v += weights[i] * weights[j] * cov(i, j);
        points.push({ weight: target, vol: Math.sqrt(Math.max(v, 0)) });
    }
    return points;
}
