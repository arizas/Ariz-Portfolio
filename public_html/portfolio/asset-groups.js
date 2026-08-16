// Grouping holdings into economic assets.
//
// The holdings table lists one row per token, which is correct for cost basis
// and tax — every token carries its own FIFO lots. It is misleading for
// concentration: NEAR, wNEAR, stNEAR and staked NEAR are four rows and one
// exposure. A portfolio that is 97 % NEAR reads as four positions of 89 / 4 / 4
// / 1 %, which looks like diversification that does not exist.
//
// Everything here is pure: it takes the object `calculatePortfolio` returns and
// derives weights from it. No I/O, no prices fetched, nothing cached.

// Symbols that are the same economic exposure. Keys are upper-case resolved
// symbols (what `resolveSymbol` produces), values are the group id.
//
// Liquid-staking tokens are included deliberately: stNEAR is NEAR exposure plus
// a validator-set claim, and for a concentration figure the NEAR part is what
// matters. That is a different judgement from EXCLUDED_STAKING_SYMBOLS in
// portfolio-data.js, which exists to stop staking derivatives being double
// counted in the *total* — see groupHoldings for how the two interact.
const GROUP_BY_SYMBOL = new Map(Object.entries({
    NEAR: 'NEAR', WNEAR: 'NEAR', STNEAR: 'NEAR', LINEAR: 'NEAR', NEARX: 'NEAR', LST: 'NEAR',
    BTC: 'BTC', WBTC: 'BTC', NBTC: 'BTC', CBBTC: 'BTC', TBTC: 'BTC', XBTC: 'BTC', HEMIBTC: 'BTC',
    ETH: 'ETH', WETH: 'ETH', STETH: 'ETH', WSTETH: 'ETH', RETH: 'ETH', WEETH: 'ETH', CBETH: 'ETH',
    SOL: 'SOL', WSOL: 'SOL', JITOSOL: 'SOL', MSOL: 'SOL', BSOL: 'SOL',
    XRP: 'XRP', CBXRP: 'XRP',
    BNB: 'BNB', WBNB: 'BNB',
    // Stablecoins are one exposure for concentration purposes: they are the
    // absence of a crypto position, not seven separate bets.
    USDC: 'USD', 'USDC.E': 'USD', USDT: 'USD', 'USDT.E': 'USD', USDT0: 'USD',
    DAI: 'USD', USDS: 'USD', USN: 'USD', FDUSD: 'USD', TUSD: 'USD', PYUSD: 'USD', USDE: 'USD',
}));

/**
 * The economic asset a resolved symbol belongs to. Unknown symbols are their
 * own group, so a new token shows up as itself rather than silently joining
 * another exposure.
 * @param {string} symbol resolved token symbol, any case
 * @returns {string} group id
 */
export function economicAsset(symbol) {
    if (!symbol) return '?';
    const key = String(symbol).toUpperCase();
    return GROUP_BY_SYMBOL.get(key) ?? key;
}

/** Stablecoin groups are exposure-free; some views want them separated out. */
export const CASH_GROUP = 'USD';

/**
 * Collapse a portfolio's holdings into economic assets and attach weights.
 *
 * Staked NEAR is folded in as NEAR: it is the single largest position in a
 * typical account here and leaving it out is precisely the distortion this
 * function exists to remove. Holdings flagged `excluded` (liquid-staking
 * derivatives, kept out of `totalValue` so they are not double counted against
 * the staking line) are included here for the same reason — so the denominator
 * below is built from the grouped values, never from `portfolio.totalValue`.
 *
 * Holdings with no price are reported separately rather than being treated as
 * zero, since a missing price understates a weight instead of erroring.
 *
 * @param {object} portfolio the object returned by calculatePortfolio
 * @returns {{groups: Array, total: number, unpriced: Array, herfindahl: number|null}}
 *   groups are sorted by value, each `{ asset, value, weight, costBasis,
 *   unrealized, members: [{ symbol, displaySymbol, token, value, amount }] }`
 */
export function groupHoldings(portfolio) {
    const byAsset = new Map();
    const unpriced = [];

    const push = (symbol, member, value, costBasis) => {
        const asset = economicAsset(symbol);
        if (!byAsset.has(asset)) {
            byAsset.set(asset, { asset, value: 0, costBasis: 0, members: [] });
        }
        const g = byAsset.get(asset);
        g.value += value;
        g.costBasis += costBasis ?? 0;
        g.members.push(member);
    };

    for (const h of portfolio.holdings ?? []) {
        if (h.value == null) {
            if (h.amount > 0) unpriced.push({ symbol: h.symbol, displaySymbol: h.displaySymbol, amount: h.amount });
            continue;
        }
        if (!(h.value > 0)) continue;
        push(h.symbol, {
            symbol: h.symbol,
            displaySymbol: h.displaySymbol ?? h.symbol,
            token: h.token,
            amount: h.amount,
            value: h.value,
        }, h.value, h.costBasis);
    }

    if (portfolio.stakedValue > 0) {
        push('NEAR', {
            symbol: 'NEAR',
            displaySymbol: 'NEAR (staked)',
            token: null,
            staked: true,
            amount: portfolio.stakedAmount,
            value: portfolio.stakedValue,
        }, portfolio.stakedValue, portfolio.stakedCostBasis ?? 0);
    }

    const groups = [...byAsset.values()].sort((a, b) => b.value - a.value);
    const total = groups.reduce((sum, g) => sum + g.value, 0);
    for (const g of groups) {
        g.weight = total > 0 ? g.value / total : 0;
        g.unrealized = g.costBasis > 0 ? g.value - g.costBasis : null;
        g.members.sort((a, b) => b.value - a.value);
    }

    return {
        groups,
        total,
        unpriced,
        herfindahl: total > 0 ? groups.reduce((sum, g) => sum + g.weight ** 2, 0) : null,
    };
}

/**
 * Effective number of positions — 1/Herfindahl. Reads better than the index
 * itself: "you hold the equivalent of 1.3 equally weighted assets" is a
 * sentence, 0.79 is not.
 * @param {number|null} herfindahl
 * @returns {number|null}
 */
export function effectivePositions(herfindahl) {
    return herfindahl > 0 ? 1 / herfindahl : null;
}
