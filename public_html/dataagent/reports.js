// The figures the app's own pages show, the year report and the portfolio, for
// the data agent to answer questions about. They come from the functions those
// pages call, so an answer about a total is about the total the user sees, and
// the agent can follow it down to the days, tokens and sales behind it.
//
// A report is not a stored dataset. It reaches the network the way its page
// does: it may fetch price history and token details, without a wallet prompt,
// and keep them in the store as the page would. Nothing else is written.

import { allTokensReport } from '../yearreport/all-tokens-collect.js';
import { calculatePeriodStartAndEndDate } from '../yearreport/yearreport-table-renderer.js';
import { isExcluded } from '../yearreport/token-exclusions.js';
import {
    getAccounts, getAllFungibleTokenEntries, getStoredRecordsFileInfo, getStoredRecordsForAccount, getTokenExclusions,
} from '../storage/domainobjectstore.js';
import { calculateFlowDecomposition, calculatePortfolio } from '../portfolio/portfolio-data.js';
import { checkBalancesAgainstChain } from '../near/balance-check.js';

const CURRENCY = /^[a-z]{3,5}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FIRST_YEAR = 2015;
const MAX_LISTED = 30;
// A token's symbol is whatever its minter wrote, sometimes a sentence or a URL.
const MAX_SYMBOL_CHARS = 40;

const currencyOf = (currency) => {
    const code = String(currency ?? '').toLowerCase();
    if (!CURRENCY.test(code)) throw new Error(`currency must be a code such as usd, eur or nok, got ${currency}`);
    return code;
};

/** What a year report is computed from, checked: it also keys the session's cache. */
export function yearReportParams({ year, currency } = {}) {
    const thisYear = new Date().getUTCFullYear();
    const y = Number(year);
    if (!Number.isInteger(y) || y < FIRST_YEAR || y > thisYear) {
        throw new Error(`year must be a year from ${FIRST_YEAR} to ${thisYear}, got ${year}`);
    }
    return { year: y, currency: currencyOf(currency) };
}

/** The portfolio page's period starts on the first of a month; any date works here. */
export function portfolioParams({ currency, fromDate = `${new Date().getUTCFullYear()}-01-01` } = {}) {
    if (!DATE.test(String(fromDate)) || Number.isNaN(Date.parse(fromDate))) throw new Error(`fromDate must be yyyy-MM-dd, got ${fromDate}`);
    return { currency: currencyOf(currency), fromDate };
}

const ACCOUNT_ID = /^(?=.{2,64}$)[a-z0-9]+([-_][a-z0-9]+)*(\.[a-z0-9]+([-_][a-z0-9]+)*)*$/;

export function balanceCheckParams({ account } = {}) {
    if (!ACCOUNT_ID.test(account ?? '')) throw new Error(`a balance check needs a valid account, got ${account}`);
    return { account };
}

const symbolText = (symbol) => {
    const text = String(symbol ?? '');
    return text.length > MAX_SYMBOL_CHARS ? `${text.slice(0, MAX_SYMBOL_CHARS)}…` : text;
};

function listed(items) {
    const shown = items.slice(0, MAX_LISTED);
    return items.length > shown.length ? [...shown, `and ${items.length - shown.length} more`] : shown;
}

const day = (date) => date.toJSON().slice(0, 10);
const tokenId = (token) => (token === '' ? 'near' : token);

async function computeYearReport({ year, currency }, { progress = () => { } } = {}) {
    const { periodStartDate, periodEndDate } = calculatePeriodStartAndEndDate(year, 0, 12);
    // The tokens the Year report page reads with every token selected.
    const entries = await getAllFungibleTokenEntries();
    const exclusions = await getTokenExclusions();
    const excluded = entries.filter((entry) => isExcluded(exclusions, entry.contractId, entry.symbol));
    const report = await allTokensReport({
        tokens: entries.filter((entry) => !excluded.includes(entry)),
        periodStartDate, periodEndDate, convertToCurrency: currency,
        onProgress: (message) => progress(`Year report ${year} in ${currency}: ${message}`),
    });
    const { rows, totals, flowTotals, flowsByDate, contributions } = report;

    const days = rows.map((row) => {
        const flows = flowsByDate[row.date] ?? {};
        return {
            date: row.date,
            balance: row.totalBalance,
            change: row.totalChange,
            addedIn: flows.deposit ?? 0,
            takenOut: flows.withdrawal ?? 0,
            received: row.received,
            stakingReward: row.stakingReward,
            expense: row.expense,
            profit: row.profit,
            loss: row.loss,
            grossDeposit: row.deposit,
            grossWithdrawal: row.withdrawal,
            swaps: flows.internalCount ?? 0,
            swapValue: flows.internalValue ?? 0,
            ownTransfers: flows.transferCount ?? 0,
            notClearlySwaps: flows.ambiguous?.length ?? 0,
            flowWithoutPrice: (flows.unpriced ?? []).map(symbolText),
            movedWithoutPrice: row.unpriced.map(symbolText),
            heldWithoutPrice: row.unvalued.map(symbolText),
            tokensMoved: row.tokens.map((token) => symbolText(token.symbol)),
        };
    }).sort((a, b) => a.date.localeCompare(b.date));

    const amount = (c, field) => c.units[field] * c.decimalConversionValue;
    const tokens = contributions
        .filter((c) => c.movedUnits || c.units.totalBalance !== 0 || c.priced === false)
        .map((c) => ({
            date: c.date,
            token: tokenId(c.token),
            symbol: symbolText(c.symbol),
            priced: c.priced,
            balanceAmount: amount(c, 'totalBalance'),
            balance: c.totalBalance,
            depositAmount: amount(c, 'deposit'),
            deposit: c.deposit,
            withdrawalAmount: amount(c, 'withdrawal'),
            withdrawal: c.withdrawal,
            receivedAmount: amount(c, 'received'),
            received: c.received,
            stakingRewardAmount: amount(c, 'stakingRewards'),
            stakingReward: c.stakingReward,
            expenseAmount: amount(c, 'expense'),
            expense: c.expense,
            profit: c.profit,
            loss: c.loss,
        }));

    const realizations = contributions.flatMap((c) => c.realizations.map((r) => ({
        date: r.date,
        token: tokenId(c.token),
        symbol: symbolText(c.symbol),
        amount: r.amount * c.decimalConversionValue,
        boughtOn: r.position?.date ?? null,
        boughtAt: r.position?.conversionRate ?? null,
        soldAt: r.conversionRate,
        cost: r.initialConvertedValue,
        proceeds: r.convertedValue,
        profit: r.profit,
        loss: r.loss,
        soldIn: r.swap ? `swap, valued by ${r.swap.valuedBy}` : 'day price',
        boughtIn: r.position?.swap ? `swap, valued by ${r.position.swap.valuedBy}` : 'day price',
        swapKey: r.swap?.key ?? null,
    })));

    const from = day(periodStartDate);
    const to = day(periodEndDate);
    const summary = {
        report: 'year report, every token together',
        year, currency, from, to,
        balanceEndOfFirstDay: days.find((d) => d.date === from)?.balance ?? null,
        balanceEndOfLastDay: days.find((d) => d.date === to)?.balance ?? null,
        addedIn: flowTotals.deposit,
        takenOut: flowTotals.withdrawal,
        received: totals.received,
        stakingRewards: totals.stakingReward,
        expenses: totals.expense,
        realizedProfit: totals.profit,
        realizedLoss: totals.loss,
        grossDeposits: totals.deposit,
        grossWithdrawals: totals.withdrawal,
        tokensRead: entries.length - excluded.length + 1,
        tokensWithFigures: new Set(tokens.map((t) => t.token)).size,
        realizations: realizations.length,
        daysWithActivity: days.filter((d) => d.tokensMoved.length || d.movedWithoutPrice.length || d.heldWithoutPrice.length).length,
        daysWithTransactionsNotClearlySwaps: days.filter((d) => d.notClearlySwaps > 0).length,
        excludedByUser: listed(excluded.map((entry) => symbolText(entry.symbol ?? entry.contractId))),
        leftOutAfterAnError: listed(report.failed.map((f) => ({ symbol: symbolText(f.symbol), error: String(f.message).slice(0, 200) }))),
        noMarketInPeriod: listed(report.neverPriced.map((t) => symbolText(t.symbol))),
        movedOnDaysWithoutPrice: listed(totals.unpriced.map(symbolText)),
        heldOnDaysWithoutPrice: listed(totals.unvalued.map(symbolText)),
        pricesUnavailable: report.pricesUnavailable.signature
            ? 'the Ariz gateway session has expired, so only stored prices were used'
            : report.pricesUnavailable.gateway ? `prices could not be loaded (${report.pricesUnavailable.gateway}), so only stored prices were used` : null,
        meaning: 'addedIn and takenOut are what crossed the portfolio\'s edge: a swap between own tokens is neither. grossDeposits and grossWithdrawals are the per-token sums, swaps included. realizedProfit and realizedLoss count every disposal, swaps included.',
        drillDown: 'yearReportDays, yearReportTokens and yearReportRealizations, with the same year and currency',
    };
    return { summary, days, tokens, realizations };
}

// Numbers, short strings and flags as they are; a list by its length; one level of object.
function plain(value, depth = 0) {
    if (value === null || ['number', 'boolean'].includes(typeof value)) return value;
    if (typeof value === 'string') return value.slice(0, 200);
    if (Array.isArray(value)) return `${value.length} items`;
    if (typeof value === 'object' && depth < 2) {
        return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, plain(inner, depth + 1)]));
    }
    return undefined;
}

async function computePortfolio({ currency, fromDate }) {
    const portfolio = await calculatePortfolio(currency, fromDate);
    let change;
    try {
        change = plain(await calculateFlowDecomposition(currency, fromDate));
    } catch (error) {
        change = { ok: false, reason: String(error?.message ?? error).slice(0, 200) };
    }
    const holdings = portfolio.holdings.map((h) => ({
        token: h.token,
        symbol: symbolText(h.displaySymbol ?? h.symbol),
        excluded: !!h.excluded,
        amount: h.amount,
        price: h.price,
        value: h.value,
        costBasis: h.costBasis,
        unrealized: h.unrealized,
        realizedSinceFromDate: h.realized,
        priceMissing: !!h.priceMissing,
        missingCostBasis: !!h.missingCostBasis,
        amountAtFromDate: h.ibAmount,
        valueAtFromDate: h.ibValue,
        costBasisAtFromDate: h.ibCostBasis,
    }));
    const { holdings: _, pricesUnavailable, ...figures } = portfolio;
    const summary = {
        report: 'portfolio: liquid holdings now, staked NEAR apart, and the period since fromDate',
        ...plain(figures),
        pricesUnavailable: plain(pricesUnavailable ?? null),
        holdings: holdings.length,
        holdingsWithoutPrice: listed(holdings.filter((h) => h.priceMissing).map((h) => h.symbol)),
        holdingsWithoutCostBasis: listed(holdings.filter((h) => h.missingCostBasis).map((h) => h.symbol)),
        changeSinceFromDate: change,
        drillDown: 'portfolioHoldings, with the same currency and fromDate',
    };
    return { summary, holdings };
}

export async function computeBalanceCheck({ account }, { check = checkBalancesAgainstChain, progress = () => { } } = {}) {
    // Only the portfolio's own accounts: this asks public RPC about each token,
    // and a script must not turn it into a scanner of anyone's accounts.
    if (!(await getAccounts()).includes(account)) throw new Error(`${account} is not one of the portfolio's accounts`);
    const file = await getStoredRecordsFileInfo(account);
    if (!file) throw new Error(`${account} has no stored records to check: fetch its transactions first`);
    progress(`Reading the stored records of ${account}`);
    const result = await check(account, await getStoredRecordsForAccount(account), { progress });
    const of = (status) => result.tokens.filter((token) => token.status === status);
    const brief = ({ token, kind, stored, now, atLastStoredBlock, lastStoredTime, difference, error }) =>
        ({ token, kind, stored, now, atLastStoredBlock, lastStoredTime, difference, error });
    const rows = [...result.tokens, ...result.heldButNotStored.map((held) => ({ ...held, status: 'not stored' }))];
    const summary = {
        report: 'stored balances against the chain',
        account,
        storedFile: file,
        chainHeight: result.chainHeight,
        blocksSinceStoredFile: file.lastBlock ? result.chainHeight - file.lastBlock : null,
        tokensChecked: result.tokens.length,
        current: of('current').length,
        behind: listed(of('behind').map(brief)),
        wrong: listed(of('wrong').map(brief)),
        unknown: listed(of('unknown').map(brief)),
        heldButNotStored: listed(result.heldButNotStored),
        holdingsNotListed: result.holdingsError,
        meaning: 'current: the chain holds what the store ends on. behind: the store was right at its last row and the token moved since, so fetching the account brings it up to date; staking pools are always a little behind, by the rewards since. wrong: the chain never held what the store ends on, so the stored history is wrong or has a gap. heldButNotStored: held now with no stored row at all. Amounts are raw integers in the token\'s smallest unit.',
        drillDown: 'balanceCheck, with the same account',
    };
    return { summary, rows };
}

// A report reads every token and may fetch prices for each. A script waiting for
// one does not use up its own time, so this is what stops a loop over made-up
// currencies from sending the gateway a request per token per currency.
export const MAX_REPORTS_PER_SESSION = 8;
// A balance check is not one of those: it can only be of the portfolio's own
// accounts, so what bounds it is how often one account may be tried again.
export const MAX_BALANCE_CHECK_TRIES = 3;

/** Reports for one agent session, each computed once per set of parameters. */
export function createReports({ year = computeYearReport, portfolio = computePortfolio, balances = computeBalanceCheck, progress = () => { } } = {}) {
    const cache = new Map();
    // Started, not kept: a failed one is dropped from the cache so it can be
    // retried, and must still count.
    let started = 0;
    const tries = new Map();
    const cached = (kind, params, compute) => {
        const key = JSON.stringify([kind, params]);
        if (!cache.has(key)) {
            if (kind === 'balance check') {
                if ((tries.get(key) ?? 0) >= MAX_BALANCE_CHECK_TRIES) {
                    throw new Error(`the balance check of ${params.account} failed ${MAX_BALANCE_CHECK_TRIES} times this session: say so rather than trying again`);
                }
                tries.set(key, (tries.get(key) ?? 0) + 1);
            } else {
                if (started >= MAX_REPORTS_PER_SESSION) {
                    throw new Error(`this session has computed ${MAX_REPORTS_PER_SESSION} reports, the most it may: use the ones already computed`);
                }
                started++;
            }
            if (kind !== 'balance check') progress(`Computing the ${kind}: the first time can take a minute`);
            cache.set(key, compute(params, { progress }).catch((error) => {
                cache.delete(key);
                throw new Error(`the ${kind} could not be computed: ${error?.message ?? error}`);
            }));
        }
        return cache.get(key);
    };
    return {
        year: (args) => cached('year report', yearReportParams(args), year),
        portfolio: (args) => cached('portfolio', portfolioParams(args), portfolio),
        balances: (args) => cached('balance check', balanceCheckParams(args), balances),
        // Every account, one after the other, in brief: one step for the model
        // instead of one per account.
        allBalances: async () => {
            const accounts = await getAccounts();
            const out = [];
            for (const [index, account] of accounts.entries()) {
                progress(`Account ${index + 1} of ${accounts.length}: ${account}`);
                try {
                    const { summary } = await cached('balance check', balanceCheckParams({ account }), balances);
                    const names = (list) => list.filter((item) => typeof item === 'object').map((item) => item.token);
                    out.push({
                        account,
                        storedFileUpdatedAt: summary.storedFile.updatedAt ?? null,
                        blocksSinceStoredFile: summary.blocksSinceStoredFile,
                        tokensChecked: summary.tokensChecked,
                        current: summary.current,
                        behind: names(summary.behind),
                        wrong: names(summary.wrong),
                        unknown: names(summary.unknown),
                        heldButNotStored: names(summary.heldButNotStored),
                        holdingsNotListed: summary.holdingsNotListed,
                    });
                } catch (error) {
                    out.push({ account, error: String(error?.message ?? error) });
                }
            }
            return {
                report: 'stored balances against the chain, every account',
                accounts: out,
                meaning: 'Token names only, at most a few per list: balance_check with an account gives the amounts. behind: moved since the stored data ends, fetching brings it up to date. wrong: the chain never held what the stored data ends on. error: that account was not checked.',
            };
        },
        clear: () => cache.clear(),
    };
}
