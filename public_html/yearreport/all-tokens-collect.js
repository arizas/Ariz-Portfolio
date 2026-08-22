// Gathering every token's year report so the days can be added together.
//
// The pure combining lives in all-tokens-daily.js. This is the I/O half: it runs
// the same per-token pass the single-token table runs, through the same
// conversion functions, and hands the results over one day at a time.
//
// Going through the existing conversion functions rather than reimplementing
// them is the point. Native NEAR prices deposits at the custom buy rate and
// takes withdrawals at their recorded sale amount; a second implementation would
// have to remember that, and would eventually stop agreeing with the table it is
// supposed to let you check.

import {
    calculateYearReportData, calculateProfitLoss,
    getConvertedValuesForDay, getFungibleTokenConvertedValuesForDay,
    getDecimalConversionValue, getTokenSymbol,
} from './yearreportdata.js';
import { getEODPriceMap } from '../pricedata/pricedata.js';
import { getReceivedAccounts } from '../storage/domainobjectstore.js';
import { movementsForToken, receivedClassifier, mergedReceivedTypes } from '../portfolio/flow-extract.js';
import { separateSwaps } from '../portfolio/flow-decomposition.js';
import { separatePortfolioTransfers } from '../portfolio/portfolio-transfers.js';

/** Native NEAR is the token whose id is the empty string, everywhere in here. */
export const NATIVE_NEAR = '';

const defaultDeps = {
    calculateYearReportData, calculateProfitLoss,
    getConvertedValuesForDay, getFungibleTokenConvertedValuesForDay,
    getDecimalConversionValue, getTokenSymbol,
    getEODPriceMap, getReceivedAccounts, separateSwaps,
};

/**
 * Every token's contribution to every day in the period, in one currency.
 *
 * @param {object} options
 * @param {Array<{contractId: string, symbol?: string}>} options.tokens  fungible
 *   tokens; native NEAR is added by this function and need not be listed
 * @param {Date} options.periodStartDate
 * @param {Date} options.periodEndDate
 * @param {string} options.convertToCurrency  required — token units cannot be added
 * @param {(message: string) => void} [options.onProgress]
 * @param {object} [options.deps]  seam for tests
 * @returns {Promise<{contributions: Array, transactionsByDate: Object<string, Array>,
 *   failed: Array, neverPriced: Array}>}
 */
export async function collectAllTokenDays({
    tokens, periodStartDate, periodEndDate, convertToCurrency, onProgress = () => { }, deps,
} = {}) {
    if (!convertToCurrency) {
        throw new Error('Adding tokens together needs a currency to add them in');
    }
    const d = { ...defaultDeps, ...deps };

    const dates = datesInPeriod(periodStartDate, periodEndDate);
    const contributions = [];
    const transactionsByDate = {};
    const failed = [];
    const neverPriced = [];
    const tokenMovements = [];
    const priceByToken = new Map();

    // Shipped defaults sit under the user's own choices, the same way the flow
    // panel does it, so a known payer arrives pre-classified.
    const classify = receivedClassifier(
        mergedReceivedTypes(await d.getReceivedAccounts().catch(() => ({}))));

    const all = [{ contractId: NATIVE_NEAR, symbol: 'NEAR' }, ...(tokens ?? [])];
    let done = 0;
    for (const entry of all) {
        const token = entry.contractId;
        const symbol = token === NATIVE_NEAR ? 'NEAR' : (entry.symbol || d.getTokenSymbol(token) || token);
        onProgress(`Reading ${symbol} (${++done} of ${all.length})`);

        let dailyBalances, tokenTransactions;
        try {
            ({ dailyBalances, transactionsByDate: tokenTransactions } = await d.calculateYearReportData(token));
            dailyBalances = (await d.calculateProfitLoss(dailyBalances, convertToCurrency, token)).dailyBalances;
        } catch (e) {
            // One token that cannot be read must not take the whole view down —
            // but it must be named, or the totals are quietly short a leg.
            console.error(`Year report failed for ${symbol}`, e);
            failed.push({ token, symbol, message: e?.message ?? String(e) });
            continue;
        }

        const decimalConversionValue = token === NATIVE_NEAR
            ? Math.pow(10, -24) : d.getDecimalConversionValue(token);

        // Held back until the whole period is read, so a token that turns out to
        // have no market anywhere can be reported once instead of on every day.
        const tokenContributions = [];
        let pricedAnyDay = false;

        // One movement per transaction, which is what makes a swap recognisable
        // later: the daily deposit and withdrawal totals cannot be taken back
        // apart once summed.
        tokenMovements.push(...movementsForToken({
            token, symbol, dailyBalances, decimalConversionValue,
            classifyReceived: classify,
            from: dates[0], to: dates[dates.length - 1],
        }));
        priceByToken.set(token, await priceMap(d, convertToCurrency, token));

        for (const date of dates) {
            const rowdata = dailyBalances[date];
            if (!rowdata) continue;

            const { stakingReward, received, deposit, withdrawal, expense, conversionRate } =
                token === NATIVE_NEAR
                    ? await d.getConvertedValuesForDay(rowdata, convertToCurrency, date)
                    : await d.getFungibleTokenConvertedValuesForDay(rowdata, token, convertToCurrency, date);

            const units = {
                stakingRewards: Number(rowdata.stakingRewards ?? 0),
                received: Number(rowdata.received ?? 0),
                deposit: Number(rowdata.deposit ?? 0),
                withdrawal: Number(rowdata.withdrawal ?? 0),
                expense: Number(rowdata.expense ?? 0),
                totalBalance: Number(rowdata.totalBalance ?? 0),
                totalChange: Number(rowdata.totalChange ?? 0),
                accountBalance: Number(rowdata.accountBalance ?? 0),
                accountChange: Number(rowdata.accountChange ?? 0),
                stakingBalance: Number(rowdata.stakingBalance ?? 0),
                stakingChange: Number(rowdata.stakingChange ?? 0),
            };

            // No rate is only a problem when there was something to convert. A
            // token that held nothing that day is not an unpriced day, it is an
            // absent one, and listing it would bury the days that do matter.
            // A missing price is two different problems. On a day the token moved,
            // the day's deposits and withdrawals are wrong. On a day it only sat
            // there, just the balance column is short. Only the first one changes
            // the numbers you would check a flow against.
            const movedUnits = units.stakingRewards !== 0 || units.received !== 0
                || units.deposit !== 0 || units.withdrawal !== 0 || units.expense !== 0;
            const somethingToPrice = movedUnits || units.totalBalance !== 0 || units.totalChange !== 0;
            const priced = conversionRate !== 0 || !somethingToPrice;
            if (conversionRate !== 0) pricedAnyDay = true;

            tokenContributions.push({
                token, symbol, date, priced, movedUnits,
                stakingReward, received, deposit, withdrawal, expense,
                profit: Number(rowdata.profit ?? 0),
                loss: Number(rowdata.loss ?? 0),
                totalBalance: conversionRate * units.totalBalance * decimalConversionValue,
                totalChange: conversionRate * units.totalChange * decimalConversionValue,
                accountBalance: conversionRate * units.accountBalance * decimalConversionValue,
                accountChange: conversionRate * units.accountChange * decimalConversionValue,
                stakingBalance: conversionRate * units.stakingBalance * decimalConversionValue,
                stakingChange: conversionRate * units.stakingChange * decimalConversionValue,
                units, decimalConversionValue,
            });

            for (const tx of tokenTransactions?.[date] ?? []) {
                (transactionsByDate[date] ??= []).push({ ...tx, token, symbol, decimalConversionValue });
            }
        }

        // Two different things look identical on a single day: a real asset with
        // a hole in its price history, and an airdropped token that has never had
        // a market at all. Left together, a store full of scam tokens puts a
        // warning on all 365 days and buries the one day that matters. A token
        // that was never priced across the whole period is the second kind: said
        // once, above the table, and kept out of the days.
        if (!pricedAnyDay && tokenContributions.some(c => c.priced === false)) {
            neverPriced.push({ token, symbol });
            continue;
        }
        contributions.push(...tokenContributions);
    }

    const flowsByDate = portfolioFlows({
        movements: tokenMovements,
        priceByToken,
        skip: new Set(neverPriced.map(t => t.token)),
        separate: d.separateSwaps,
    });

    return { contributions, transactionsByDate, failed, neverPriced, flowsByDate };
}

/** The whole EOD history for one token, in the shape the price lookup wants. */
async function priceMap(d, currency, token) {
    try {
        return await d.getEODPriceMap(currency, token) ?? {};
    } catch {
        return {};
    }
}

/**
 * What actually crossed the portfolio's edge, per day.
 *
 * Summing each token's deposits and withdrawals answers a different question
 * than the one being asked. A swap is a withdrawal in one token's pass and a
 * deposit in another's, so a day spent moving 1 700 kr between your own tokens
 * reads as 1 700 kr added and 2 780 kr taken out — gross churn, with the real
 * answer nowhere on the row.
 *
 * Netting the two by value does not fix it either: prices are end-of-day, the
 * swap executed intraday, and the leftover is the intraday move — real
 * performance, which would then be booked as a deposit nobody made. The pair has
 * to be recognised by its transaction and removed whole, which is exactly what
 * the flow panel does, through the same function.
 *
 * Where that panel refuses over a transaction whose sides do not match, this one
 * cannot: a year of days must not disappear over one of them. Such a transaction
 * is counted as crossing the edge — the conservative reading — and the day is
 * marked so it can be looked at.
 */
export function portfolioFlows({ movements, priceByToken, skip = new Set(), separate = separateSwaps }) {
    const live = movements.filter(m => !skip.has(m.token));
    const price = (token, date) => {
        const map = priceByToken.get(token);
        if (!map) return null;
        if (map.__constant != null) return map.__constant;
        const p = map[date];
        return p == null || p === 0 ? null : p;
    };

    const { internal, external: crossedOrMoved, suspect } = separate(live, price);
    // Swaps share a transaction; a move between the portfolio's own buckets does
    // not, and is just as much not a flow.
    const { internal: transfers, external } = separatePortfolioTransfers(crossedOrMoved);
    const byDate = {};
    const dayOf = (date) => (byDate[date] ??= {
        deposit: 0, withdrawal: 0, internalCount: 0, internalValue: 0,
        transferCount: 0, transferValue: 0, ambiguous: [], unpriced: [],
    });

    const add = (m) => {
        const day = dayOf(m.date);
        const p = price(m.token, m.date);
        if (p == null || !Number.isFinite(p)) {
            if (!day.unpriced.includes(m.symbol ?? m.token)) day.unpriced.push(m.symbol ?? m.token);
            return;
        }
        const value = Math.abs(m.units * p);
        if (m.kind === 'deposit') day.deposit += value;
        else if (m.kind === 'withdrawal' || m.kind === 'expense') day.withdrawal += value;
    };

    for (const m of external) add(m);
    for (const detail of suspect) {
        dayOf(detail.date).ambiguous.push(detail);
        for (const m of detail.movements ?? []) add(m);
    }
    for (const detail of internal) {
        const day = dayOf(detail.date);
        day.internalCount += 1;
        day.internalValue += Math.max(detail.inValue ?? 0, detail.outValue ?? 0);
    }
    for (const detail of transfers) {
        const day = dayOf(detail.date);
        day.transferCount += 1;
        const leg = detail.movements[0];
        const p = price(leg.token, leg.date);
        if (p != null && Number.isFinite(p)) day.transferValue += Math.abs(leg.units * p);
    }
    return byDate;
}

/** Every yyyy-MM-dd in the period, oldest first. */
export function datesInPeriod(periodStartDate, periodEndDate) {
    const dates = [];
    for (let t = periodStartDate.getTime(); t <= periodEndDate.getTime(); t += 24 * 60 * 60 * 1000) {
        dates.push(new Date(t).toJSON().substring(0, 'yyyy-MM-dd'.length));
    }
    return dates;
}
