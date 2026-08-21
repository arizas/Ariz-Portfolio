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

/** Native NEAR is the token whose id is the empty string, everywhere in here. */
export const NATIVE_NEAR = '';

const defaultDeps = {
    calculateYearReportData, calculateProfitLoss,
    getConvertedValuesForDay, getFungibleTokenConvertedValuesForDay,
    getDecimalConversionValue, getTokenSymbol,
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

    return { contributions, transactionsByDate, failed, neverPriced };
}

/** Every yyyy-MM-dd in the period, oldest first. */
export function datesInPeriod(periodStartDate, periodEndDate) {
    const dates = [];
    for (let t = periodStartDate.getTime(); t <= periodEndDate.getTime(); t += 24 * 60 * 60 * 1000) {
        dates.push(new Date(t).toJSON().substring(0, 'yyyy-MM-dd'.length));
    }
    return dates;
}
