// Portfolio: fiscal-year movement (IB -> realized -> UB) + current status.
//
// Reuses the year report FIFO engine (calculateYearReportData + calculateProfitLoss).
//
//   IB (opening balance, at the "from" date)
//   + realized gain/loss during the period (every disposal / swap is a realization)
//   + change in unrealized value
//   = UB (closing balance, now)
//
// How each number is derived from the FIFO:
//   - UB holdings / cost basis / value : openPositions after the FULL history pass.
//   - Realized P/L in period           : per-day FIFO profit/loss, summed from the
//                                        "from" date to today.
//   - IB holdings / cost basis         : openPositions after a FIFO pass TRUNCATED to
//                                        days before the "from" date.
//   - IB market value                  : IB holdings valued at the EOD price on the
//                                        "from" date.
//
// Two-level caching: the heavy full-history FIFO + price fetch runs once per
// currency (baseCache). IB (which depends on the "from" date) is a CPU-only
// truncated FIFO pass, cached per currency+date.

import { getAllFungibleTokenEntries } from '../storage/domainobjectstore.js';
import {
    calculateYearReportData,
    calculateProfitLoss,
    getDecimalConversionValue
} from '../yearreport/yearreportdata.js';
import { resolveSymbol, resolveDisplaySymbol } from '../near/intents-tokens.js';
import { getCurrentPrices, getEODPrice, PriceServiceUnavailableError } from '../pricedata/pricedata.js';

// Liquid-staking token symbols excluded from the portfolio total (treated as staking).
export const EXCLUDED_STAKING_SYMBOLS = new Set(['STNEAR', 'LINEAR', 'NEARX', 'LST']);

const NEAR_TOKEN = ''; // native NEAR is represented by an empty token id in the year report
const DUST_THRESHOLD = 1e-9;

const baseCache = new Map(); // currency -> base data (heavy: FIFO + prices)
const ibCache = new Map();   // `${currency}|${fromDate}` -> Map(token -> ib snapshot)

export function clearPortfolioCache() {
    baseCache.clear();
    ibCache.clear();
}

async function getTokenList() {
    const tokens = [{ token: NEAR_TOKEN, symbol: 'NEAR', displaySymbol: 'NEAR' }];
    const ftEntries = await getAllFungibleTokenEntries();
    for (const entry of ftEntries) {
        const symbol = (await resolveSymbol(entry.contractId)) || entry.symbol;
        const displaySymbol = await resolveDisplaySymbol(entry.contractId, entry.symbol);
        tokens.push({ token: entry.contractId, symbol, displaySymbol });
    }
    return tokens;
}

function summarizeOpenPositions(openPositions) {
    let remainingRaw = 0;
    let costBasis = 0;
    for (const position of openPositions) {
        remainingRaw += position.remainingAmount;
        if (position.initialAmount > 0) {
            costBasis += position.convertedValue * (position.remainingAmount / position.initialAmount);
        }
    }
    return { remainingRaw, costBasis };
}

/**
 * Heavy per-currency computation, cached. Runs the full-history FIFO for every
 * token to get current holdings, cost basis, the per-day realized series, current
 * prices/value/unrealized, and keeps each token's daily balances for IB passes.
 */
async function computeBase(currency, onProgress, force) {
    if (!force && baseCache.has(currency)) {
        return baseCache.get(currency);
    }

    const tokens = await getTokenList();
    const holdings = [];

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        onProgress(`Calculating ${t.displaySymbol} (${i + 1}/${tokens.length})`);

        const excluded = EXCLUDED_STAKING_SYMBOLS.has(t.symbol.toUpperCase());

        const { dailyBalances } = await calculateYearReportData(t.token);
        const { openPositions } = await calculateProfitLoss(dailyBalances, currency, t.token);

        const decimalConversionValue = t.token
            ? getDecimalConversionValue(t.token)
            : Math.pow(10, -24);

        const { remainingRaw, costBasis } = summarizeOpenPositions(openPositions);
        const amount = remainingRaw * decimalConversionValue;

        // Per-day realized net P/L (gain - loss) from FIFO disposals. FIFO is
        // prefix-consistent, so a later truncated pass won't change these days.
        const realizationsByDate = [];
        for (const datestring in dailyBalances) {
            const net = (dailyBalances[datestring].profit || 0) - (dailyBalances[datestring].loss || 0);
            if (net !== 0) {
                realizationsByDate.push({ date: datestring, net });
            }
        }

        holdings.push({
            token: t.token,
            symbol: t.symbol,
            displaySymbol: t.displaySymbol,
            excluded,
            amount,
            costBasis,
            missingCostBasis: amount > DUST_THRESHOLD && !(costBasis > 0),
            realizationsByDate,
            decimalConversionValue,
            dailyBalances
        });
    }

    onProgress('Fetching current prices');
    const pricedSymbols = holdings.filter(h => h.amount > DUST_THRESHOLD).map(h => h.symbol);
    let currentPrices = {};
    let pricesUnavailable = false;
    try {
        currentPrices = await getCurrentPrices(pricedSymbols, currency);
    } catch (e) {
        // Price service unreachable (transient, affects every token). Keep going so
        // cached cost basis / realized still render, but flag it so the page can say
        // so explicitly rather than making every holding look like it has "no price".
        currentPrices = {};
        if (e instanceof PriceServiceUnavailableError) {
            pricesUnavailable = true;
        } else {
            throw e;
        }
    }

    let totalValue = 0;
    let totalCost = 0;
    let excludedValue = 0;
    for (const h of holdings) {
        const price = currentPrices[h.symbol] ?? null;
        h.price = price;
        h.value = price != null ? h.amount * price : null;
        h.priceMissing = price == null && h.amount > DUST_THRESHOLD;
        h.unrealized = (h.value != null) ? h.value - h.costBasis : null;
        h.unrealizedPct = (h.unrealized != null && h.costBasis > 0)
            ? (h.unrealized / h.costBasis) * 100 : null;
        if (h.value != null) {
            if (h.excluded) excludedValue += h.value;
            else { totalValue += h.value; totalCost += h.costBasis; }
        }
    }

    // Staking (NEAR-only in this app) is excluded from the FIFO, so staked NEAR is
    // not in the liquid holdings above. Expose the staked-NEAR balance series (raw
    // yocto per day) so the portfolio can show it as its own line and value it.
    const nearHolding = holdings.find(h => h.token === NEAR_TOKEN);
    const stakedRawByDate = {};
    if (nearHolding) {
        for (const ds in nearHolding.dailyBalances) {
            const sb = nearHolding.dailyBalances[ds].stakingBalance;
            if (sb) stakedRawByDate[ds] = sb;
        }
    }

    const base = {
        currency, holdings, totalValue, totalCost, excludedValue,
        stakedRawByDate,
        pricesUnavailable,
        nearPrice: currentPrices['NEAR'] ?? null,
        nearDecimal: Math.pow(10, -24)
    };
    baseCache.set(currency, base);
    return base;
}

/**
 * IB snapshot (opening balance) per token at `fromDate`: holdings and cost basis
 * from a FIFO pass truncated to days BEFORE fromDate, valued at the EOD price on
 * fromDate. Cached per currency+date.
 */
async function computeIbSnapshot(base, currency, fromDate, onProgress) {
    const cacheKey = `${currency}|${fromDate}`;
    if (ibCache.has(cacheKey)) {
        return ibCache.get(cacheKey);
    }

    const snapshot = new Map();
    for (const h of base.holdings) {
        // Truncate daily balances to days strictly before the from date.
        const truncated = {};
        for (const ds in h.dailyBalances) {
            if (ds < fromDate) truncated[ds] = h.dailyBalances[ds];
        }
        const { openPositions } = await calculateProfitLoss(truncated, currency, h.token);
        const { remainingRaw, costBasis } = summarizeOpenPositions(openPositions);
        const ibAmount = remainingRaw * h.decimalConversionValue;

        let ibValue = null;
        if (ibAmount > DUST_THRESHOLD) {
            const ibPrice = await getEODPrice(currency, fromDate, h.token);
            ibValue = ibPrice ? ibAmount * ibPrice : null;
        } else {
            ibValue = 0;
        }

        snapshot.set(h.token, { ibAmount, ibCostBasis: costBasis, ibValue });
    }

    ibCache.set(cacheKey, snapshot);
    return snapshot;
}

/**
 * Full fiscal-year portfolio for a currency and a "from" date.
 *
 * @param {string} currency - lowercase currency code (e.g. 'nok')
 * @param {string} fromDate - 'yyyy-MM-dd'; start of the fiscal period (IB date)
 * @param {(msg:string)=>void} [onProgress]
 * @param {{force?: boolean}} [opts]
 */
export async function calculatePortfolio(currency, fromDate, onProgress = () => {}, { force = false } = {}) {
    const base = await computeBase(currency, onProgress, force);
    const ibSnapshot = await computeIbSnapshot(base, currency, fromDate, onProgress);

    let totalRealized = 0;
    let ibValue = 0;
    let ibCost = 0;

    const holdings = base.holdings.map(h => {
        let realized = 0;
        for (const r of h.realizationsByDate) {
            if (r.date >= fromDate) realized += r.net;
        }
        const ib = ibSnapshot.get(h.token) || { ibAmount: 0, ibCostBasis: 0, ibValue: 0 };
        if (!h.excluded) {
            totalRealized += realized;
            ibCost += ib.ibCostBasis || 0;
            ibValue += ib.ibValue || 0;
        }
        return {
            token: h.token,
            symbol: h.symbol,
            displaySymbol: h.displaySymbol,
            excluded: h.excluded,
            amount: h.amount,
            price: h.price,
            value: h.value,
            costBasis: h.costBasis,
            unrealized: h.unrealized,
            unrealizedPct: h.unrealizedPct,
            priceMissing: h.priceMissing,
            missingCostBasis: h.missingCostBasis,
            realized,
            ibAmount: ib.ibAmount,
            ibCostBasis: ib.ibCostBasis,
            ibValue: ib.ibValue
        };
    });

    const visibleHoldings = holdings
        .filter(h => h.amount > DUST_THRESHOLD || Math.abs(h.realized) > 1e-9 || h.ibAmount > DUST_THRESHOLD)
        .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));

    const totalUnrealized = base.totalValue - base.totalCost;

    // Staked NEAR (shown on its own line, kept out of the liquid IB→UB movement).
    // Current = latest staking balance; IB = last staking balance before fromDate
    // (0 here, since staking started during the period).
    const stakedDates = Object.keys(base.stakedRawByDate).sort();
    const currentStakedRaw = stakedDates.length ? base.stakedRawByDate[stakedDates[stakedDates.length - 1]] : 0;
    let ibStakedRaw = 0;
    for (const ds of stakedDates) {
        if (ds < fromDate) ibStakedRaw = base.stakedRawByDate[ds];
        else break;
    }
    const stakedAmount = currentStakedRaw * base.nearDecimal;
    const ibStakedAmount = ibStakedRaw * base.nearDecimal;
    const stakedValue = base.nearPrice != null ? stakedAmount * base.nearPrice : null;
    const ibNearPrice = ibStakedAmount > DUST_THRESHOLD ? await getEODPrice(currency, fromDate, NEAR_TOKEN) : 0;
    const ibStakedValue = ibStakedAmount > DUST_THRESHOLD ? ibStakedAmount * ibNearPrice : 0;

    return {
        currency,
        fromDate,
        pricesUnavailable: base.pricesUnavailable,
        holdings: visibleHoldings,
        // UB (now) — liquid holdings
        totalValue: base.totalValue,
        totalCost: base.totalCost,
        totalUnrealized,
        totalUnrealizedPct: base.totalCost > 0 ? (totalUnrealized / base.totalCost) * 100 : null,
        excludedValue: base.excludedValue,
        // IB (opening balance) — liquid holdings
        ibValue,
        ibCost,
        // Period result
        totalRealized,
        totalResult: totalRealized + totalUnrealized,
        // Staking (NEAR), shown separately
        stakedAmount,
        stakedValue,
        ibStakedAmount,
        ibStakedValue,
        // Complete asset picture
        totalWithStaked: base.totalValue + (stakedValue || 0),
        ibWithStaked: ibValue + (ibStakedValue || 0)
    };
}
