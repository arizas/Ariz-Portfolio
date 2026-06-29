// Portfolio holdings + unrealized profit/loss calculation.
//
// Strategy: reuse the year report FIFO engine. calculateYearReportData builds the
// full daily balance history for a token, and calculateProfitLoss runs FIFO over it.
// The `openPositions` left over after processing all history ARE the current holdings,
// each carrying its cost basis (convertedValue) in the target currency.
//
// - Current liquid amount per token = sum(openPositions[i].remainingAmount)
//   (staking is already excluded by the FIFO engine, so this is non-staked balance)
// - Cost basis = sum of remaining cost basis across open positions
// - Unrealized P/L = current market value - cost basis
//
// getEODPrice (used by the FIFO step) now auto-loads missing historical prices from
// the gateway and skips tokens the gateway reports as unpriceable, so no per-day
// prompting or pre-warming is needed here.
//
// Liquid-staking tokens (stNEAR, LiNEAR, ...) are treated as "in staking" and kept
// out of the portfolio total, per requirements.

import { getAllFungibleTokenEntries } from '../storage/domainobjectstore.js';
import {
    calculateYearReportData,
    calculateProfitLoss,
    getDecimalConversionValue
} from '../yearreport/yearreportdata.js';
import { resolveSymbol, resolveDisplaySymbol } from '../near/intents-tokens.js';
import { getCurrentPrices } from '../pricedata/pricedata.js';

// Liquid-staking token symbols excluded from the portfolio total (treated as staking).
export const EXCLUDED_STAKING_SYMBOLS = new Set(['STNEAR', 'LINEAR', 'NEARX', 'LST']);

const NEAR_TOKEN = ''; // native NEAR is represented by an empty token id in the year report

// Amounts below this (in display units) are treated as fully exited / dust.
const DUST_THRESHOLD = 1e-9;

/**
 * Build the list of tokens to include: native NEAR plus every fungible token
 * seen in the transaction history.
 */
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

/**
 * Sum remaining amount (raw units) and remaining cost basis (target currency)
 * across the FIFO open positions.
 */
function summarizeOpenPositions(openPositions) {
    let remainingRaw = 0;
    let costBasis = 0;
    for (const position of openPositions) {
        remainingRaw += position.remainingAmount;
        // Remaining cost basis is the share of the position's initial converted value
        // proportional to how much of the position is still open.
        if (position.initialAmount > 0) {
            costBasis += position.convertedValue * (position.remainingAmount / position.initialAmount);
        }
    }
    return { remainingRaw, costBasis };
}

/**
 * Calculate the full portfolio for a target currency.
 *
 * @param {string} currency - lowercase currency code (e.g. 'nok', 'usd')
 * @param {(msg: string) => void} [onProgress] - optional progress callback
 * @returns {Promise<{
 *   currency: string,
 *   holdings: Array<object>,
 *   totalValue: number,
 *   totalCost: number,
 *   totalUnrealized: number,
 *   totalUnrealizedPct: number|null,
 *   excludedValue: number
 * }>}
 */
export async function calculatePortfolio(currency, onProgress = () => {}) {
    const tokens = await getTokenList();
    const holdings = [];

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        onProgress(`Beregner ${t.displaySymbol} (${i + 1}/${tokens.length})`);

        const excluded = EXCLUDED_STAKING_SYMBOLS.has(t.symbol.toUpperCase());

        // calculateYearReportData must run before calculateProfitLoss for the same
        // token: it populates decimals/cost-basis metadata used by the FIFO step.
        const { dailyBalances } = await calculateYearReportData(t.token);
        const { openPositions } = await calculateProfitLoss(dailyBalances, currency, t.token);

        const decimalConversionValue = t.token
            ? getDecimalConversionValue(t.token)
            : Math.pow(10, -24);

        const { remainingRaw, costBasis } = summarizeOpenPositions(openPositions);
        const amount = remainingRaw * decimalConversionValue;

        holdings.push({
            token: t.token,
            symbol: t.symbol,
            displaySymbol: t.displaySymbol,
            excluded,
            amount,
            costBasis,
            // Held but no cost basis recorded (e.g. airdrop, or missing historical price)
            missingCostBasis: amount > DUST_THRESHOLD && !(costBasis > 0)
        });
    }

    // Fetch current spot prices for everything we actually hold, in one batch.
    onProgress('Henter dagens priser');
    const pricedSymbols = holdings
        .filter(h => h.amount > DUST_THRESHOLD)
        .map(h => h.symbol);

    let currentPrices = {};
    try {
        currentPrices = await getCurrentPrices(pricedSymbols, currency);
    } catch (e) {
        currentPrices = {};
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
            ? (h.unrealized / h.costBasis) * 100
            : null;

        if (h.value != null) {
            if (h.excluded) {
                excludedValue += h.value;
            } else {
                totalValue += h.value;
                totalCost += h.costBasis;
            }
        }
    }

    const totalUnrealized = totalValue - totalCost;
    const totalUnrealizedPct = totalCost > 0 ? (totalUnrealized / totalCost) * 100 : null;

    // Show held tokens (and excluded staking tokens for transparency); hide fully exited.
    const visibleHoldings = holdings
        .filter(h => h.amount > DUST_THRESHOLD)
        .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));

    return {
        currency,
        holdings: visibleHoldings,
        totalValue,
        totalCost,
        totalUnrealized,
        totalUnrealizedPct,
        excludedValue
    };
}
