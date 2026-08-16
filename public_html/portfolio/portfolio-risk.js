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
 * @param {{lookback?: number}} [options]
 * @returns {null|{
 *   assets: Array<{asset, weight, vol, riskShare}>,
 *   portfolioVol: number, weightedAvgVol: number, diversification: number,
 *   observations: number, from: string, to: string,
 *   omitted: string[], curve: Array<{weight: number, vol: number}>
 * }}
 *   null when there is not enough overlapping history to say anything.
 */
export function computeRisk(groups, seriesByAsset, { lookback = 365 } = {}) {
    const usable = groups.filter(g => g.weight > 0 && seriesByAsset.has(g.asset));
    const omitted = groups.filter(g => g.weight > 0 && !seriesByAsset.has(g.asset)).map(g => g.asset);
    if (!usable.length) return null;

    const subset = new Map(usable.map(g => [g.asset, seriesByAsset.get(g.asset)]));
    const dates = commonDates(subset, lookback);
    if (dates.length < MIN_OBSERVATIONS) return null;

    const factor = annualisationFactor(dates);
    const returns = usable.map(g => logReturns(dates.map(d => subset.get(g.asset)[d])));
    const vols = returns.map(r => stdev(r) * factor);

    // Renormalise weights across the assets we can actually measure, so the
    // portfolio figure is internally consistent even when one is omitted.
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
        assets,
        portfolioVol,
        weightedAvgVol,
        // 1.0 means the mix removes no risk at all; higher is more diversified.
        diversification: portfolioVol > 0 ? weightedAvgVol / portfolioVol : null,
        observations: dates.length,
        from: dates[0],
        to: dates[dates.length - 1],
        omitted,
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
