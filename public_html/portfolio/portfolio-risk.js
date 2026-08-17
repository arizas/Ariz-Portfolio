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
 * Estimated pairwise-complete: each asset's volatility comes from its own
 * history, and each correlation from the overlap of the two assets involved.
 * The alternative — one window common to everything — lets the shortest series
 * decide for all of them, which in practice meant dropping a real 2.4 %
 * position because it had 57 days of history against a 60-day floor, and
 * silently renormalising the other weights up to cover it.
 *
 * @param {Array<{asset: string, weight: number}>} groups from groupHoldings
 * @param {Map<string, object>} seriesByAsset asset -> daily price map
 * @param {{lookback?: number, minWeight?: number, minPairOverlap?: number}} [options]
 * @returns {{ok: true, ...}|{ok: false, reason: string, ...}}
 *   Always returns a result. When it cannot compute it says why, because a
 *   panel that silently disappears is indistinguishable from one that is broken.
 */
export function computeRisk(groups, seriesByAsset, {
    lookback = 365, minWeight = 0.001, minPairOverlap = 30,
} = {}) {
    const held = groups.filter(g => g.weight > 0);

    // Dust is excluded before anything else. The floor is 0.1 %, which lines up
    // with what the panel renders as "0.0 %" — so anything shown as zero is
    // exactly what is left out here, and such a position cannot move portfolio
    // volatility in any case.
    const dust = held.filter(g => g.weight < minWeight).map(g => g.asset);
    const material = held.filter(g => g.weight >= minWeight);
    if (!material.length) return { ok: false, reason: 'no-material-positions', dust, omitted: [] };

    // Omissions carry their reason and their count. "No usable price history"
    // covers two quite different situations — nothing at all, versus a series
    // too short to measure — and only the second one means "wait for a backfill"
    // rather than "go find the broken price lookup".
    const omitted = [];
    let candidates = [];
    for (const g of material) {
        if (!seriesByAsset.has(g.asset)) {
            omitted.push({ asset: g.asset, reason: 'no-history', observations: 0 });
            continue;
        }
        const dates = commonDates(new Map([[g.asset, seriesByAsset.get(g.asset)]]), lookback);
        if (dates.length < MIN_OBSERVATIONS) {
            omitted.push({ asset: g.asset, reason: 'short-history', observations: dates.length });
            continue;
        }
        candidates.push({
            ...g,
            dates,
            byDate: seriesByAsset.get(g.asset),
            returns: logReturns(dates.map(d => seriesByAsset.get(g.asset)[d])),
        });
    }
    if (!candidates.length) return { ok: false, reason: 'no-price-history', omitted, dust };

    // A correlation needs the two series to overlap. Where a pair does not
    // overlap enough, drop the shorter history rather than the whole
    // calculation, and keep dropping until every remaining pair can be
    // estimated.
    for (;;) {
        const bad = worstPair(candidates, minPairOverlap);
        if (!bad) break;
        const [i, j] = bad;
        const drop = candidates[i].dates.length <= candidates[j].dates.length ? i : j;
        omitted.push({
            asset: candidates[drop].asset,
            reason: 'no-overlap',
            observations: candidates[drop].dates.length,
        });
        candidates = candidates.filter((_, k) => k !== drop);
        if (candidates.length < 2) break;
    }

    const n = candidates.length;
    const factors = candidates.map(c => annualisationFactor(c.dates));
    const vols = candidates.map((c, i) => stdev(c.returns) * factors[i]);

    // Renormalise across what is actually measured, so the portfolio figure is
    // internally consistent even when something was left out.
    const totalWeight = candidates.reduce((a, g) => a + g.weight, 0);
    const w = candidates.map(g => g.weight / totalWeight);

    const rho = pairwiseCorrelations(candidates, minPairOverlap);
    const cov = (i, j) => (i === j ? vols[i] ** 2 : rho[i][j] * vols[i] * vols[j]);

    let variance = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) variance += w[i] * w[j] * cov(i, j);
    const portfolioVol = Math.sqrt(Math.max(variance, 0));

    // Euler risk contribution: w_i * (Sigma w)_i / sigma_p. These sum to sigma_p,
    // so the shares sum to 1 — the honest way to say "NEAR is 99 % of your risk".
    const assets = candidates.map((g, i) => {
        let marginal = 0;
        for (let j = 0; j < n; j++) marginal += w[j] * cov(i, j);
        const contribution = portfolioVol > 0 ? (w[i] * marginal) / portfolioVol : 0;
        return {
            asset: g.asset,
            weight: w[i],
            vol: vols[i],
            observations: g.dates.length,
            from: g.dates[0],
            to: g.dates[g.dates.length - 1],
            riskShare: portfolioVol > 0 ? contribution / portfolioVol : 0,
        };
    });

    const weightedAvgVol = w.reduce((a, wi, i) => a + wi * vols[i], 0);
    const longest = assets.reduce((a, b) => (a.observations >= b.observations ? a : b));

    return {
        ok: true,
        assets,
        portfolioVol,
        weightedAvgVol,
        // 1.0 means the mix removes no risk at all; higher is more diversified.
        diversification: portfolioVol > 0 ? weightedAvgVol / portfolioVol : null,
        // The longest series measured; individual assets carry their own window,
        // which is the point of estimating pairwise.
        observations: longest.observations,
        from: longest.from,
        to: longest.to,
        shortest: assets.reduce((a, b) => (a.observations <= b.observations ? a : b)),
        omitted,
        dust,
        required: MIN_OBSERVATIONS,
        curve: reductionCurve(w, vols, cov, n),
    };
}

/** Dates two assets both have a price for, within the lookback. */
function overlap(a, b) {
    return a.dates.filter(d => b.byDate[d] > 0);
}

/** First pair whose overlap is too short to correlate, or null. */
function worstPair(candidates, minPairOverlap) {
    for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
            if (overlap(candidates[i], candidates[j]).length < minPairOverlap) return [i, j];
        }
    }
    return null;
}

/** Correlation matrix, each entry from that pair's own overlapping dates. */
function pairwiseCorrelations(candidates, minPairOverlap) {
    const n = candidates.length;
    const rho = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
        rho[i][i] = 1;
        for (let j = i + 1; j < n; j++) {
            const dates = overlap(candidates[i], candidates[j]);
            let r = 0;
            if (dates.length >= minPairOverlap) {
                const ri = logReturns(dates.map(d => candidates[i].byDate[d]));
                const rj = logReturns(dates.map(d => candidates[j].byDate[d]));
                const c = correlation(ri, rj);
                r = Number.isFinite(c) ? c : 0;
            }
            rho[i][j] = r;
            rho[j][i] = r;
        }
    }
    return rho;
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
