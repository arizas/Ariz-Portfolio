// The application API the data agent works through, for its tools and for the
// scripts it writes alike. There are no paths and no file access here: a dataset
// has a name, and the domain store knows where it lives.
//
// Reading stored data never changes the repository and never touches the network.
// That rules out the getters that derive confidential rows (they resolve token
// metadata, which can fetch and write a cache file) and getDepositAccounts when
// the file is missing (it writes a default). So `records` and `ftTransactions` are
// what is stored, and confidential history is its own dataset.
//
// Reports are the exception, and say so: the year report and the portfolio are
// computed the way their pages compute them, prices fetched included. See
// reports.js.
//
// A change is only ever proposed. Applying one is on the session rather than in
// `api`, so neither the model nor a script can reach it: the user does.

import {
    accountsconfigfile, depositaccountsfile, getAccounts, setAccounts, getConfidentialIntentsHistory,
    getDepositAccounts, getExpenseAccounts, getHistoricalPriceData, getReceivedAccounts,
    getStakingRewardsForAccountAndPool, getStoredFungibleTokenTransactions, getStoredRecordsForAccount,
    getStoredStakingPools, getTokenExclusions, getTransactionsForAccount, listStoredPriceHistories,
    setExpenseAccounts, setReceivedAccounts,
} from '../storage/domainobjectstore.js';
import { refreshStoredPriceHistories } from '../pricedata/pricedata.js';
import { fetchAccountsFromExport, fetchConfidentialForAccount } from '../accounts/account-actions.js';
import { exists } from '../storage/gitstorage.js';
import { checkStoreFiles } from '../storage/store-check.js';
import { excludeToken, includeToken, isExcluded } from '../yearreport/token-exclusions.js';
import { balanceCheckParams, createReports, portfolioParams, yearReportParams } from './reports.js';

/** The most one answer to a script may carry; it pages for the rest. */
export const SCRIPT_PAGE_BYTES = 64 * 1024;
export const DEFAULT_QUERY_LIMIT = 100;
export const MAX_QUERY_LIMIT = 1000;
const MAX_GROUPS = 500;
const MAX_LISTED_BREAKS = 50;
const MAX_FIELD_NAMES = 60;
const MAX_LISTED_TOKENS = 30;
const MAX_SAMPLE_VALUE_CHARS = 120;

// Also what keeps a path out: the store builds file paths from the account name.
const ACCOUNT_ID = /^(?=.{2,64}$)[a-z0-9]+([-_][a-z0-9]+)*(\.[a-z0-9]+([-_][a-z0-9]+)*)*$/;
const CONTRACT_ID = /^[a-zA-Z0-9._:-]{1,128}$/;

const noTokens = () => [];

const DATASETS = {
    accounts: {
        description: 'The accounts this portfolio tracks.',
        load: async () => ((await exists(accountsconfigfile)) ? await getAccounts() : []).map((accountId) => ({ accountId })),
        tokens: noTokens,
    },
    transactions: {
        description: 'NEAR transactions of an account, with the balance after each.',
        perAccount: true,
        load: ({ account }) => getTransactionsForAccount(account),
        tokens: () => ['near'],
    },
    ftTransactions: {
        description: 'Stored fungible token transactions of an account.',
        perAccount: true,
        load: ({ account }) => getStoredFungibleTokenTransactions(account),
        tokens: (row) => [row.ft?.contract_id, row.ft?.symbol],
    },
    records: {
        description: 'Stored balance changes of an account from the accounting export, with balance_before and balance_after.',
        perAccount: true,
        load: ({ account }) => getStoredRecordsForAccount(account),
        tokens: (row) => [row.token_id],
    },
    confidentialHistory: {
        description: 'Confidential intents history of an account, as fetched.',
        perAccount: true,
        load: ({ account }) => getConfidentialIntentsHistory(account),
        tokens: (row) => [row.originAsset, row.destinationAsset],
    },
    staking: {
        description: 'Staking balances of an account, one row per pool and day, with the pool in `pool`.',
        perAccount: true,
        load: async ({ account }) => {
            const rows = [];
            for (const pool of await getStoredStakingPools(account)) {
                for (const row of await getStakingRewardsForAccountAndPool(account, pool)) rows.push({ pool, ...row });
            }
            return rows;
        },
        tokens: () => ['near'],
    },
    prices: {
        description: 'Stored daily prices, one row per token, currency and date.',
        load: async () => {
            const rows = [];
            for (const { token, currency } of await listStoredPriceHistories()) {
                const prices = await getHistoricalPriceData(token, currency);
                for (const date of Object.keys(prices)) rows.push({ token, currency, date, price: prices[date] });
            }
            return rows;
        },
        tokens: (row) => [row.token],
    },
    tokenExclusions: {
        description: 'Tokens left out of the year report, and tokens the user chose to keep.',
        load: async () => {
            const { excluded, kept } = await getTokenExclusions();
            return [...excluded.map((token) => ({ status: 'excluded', ...token })),
                ...kept.map((contractId) => ({ status: 'kept', contractId }))];
        },
        tokens: (row) => [row.contractId, row.symbol],
    },
    counterparties: {
        description: 'Accounts the user categorized as deposit, received or expense counterparties.',
        load: async () => {
            const categories = {
                deposit: (await exists(depositaccountsfile)) ? await getDepositAccounts() : {},
                received: await getReceivedAccounts(),
                expense: await getExpenseAccounts(),
            };
            return Object.entries(categories).flatMap(([category, accounts]) =>
                Object.entries(accounts).map(([account, value]) => ({ category, account, value })));
        },
        tokens: noTokens,
    },
    yearReportDays: {
        description: 'The Year report with every token together, in one currency: one row per day of the year, the same figures as the page. addedIn and takenOut crossed the portfolio\'s edge; swaps are neither.',
        report: 'year',
        load: (args, reports) => reports.year(args).then((report) => report.days),
        tokens: (row) => row.tokensMoved,
    },
    yearReportTokens: {
        description: 'The Year report per token and day: balance, deposits, withdrawals, rewards, profit and loss, in token units (…Amount) and in the currency.',
        report: 'year',
        load: (args, reports) => reports.year(args).then((report) => report.tokens),
        tokens: (row) => [row.token, row.symbol],
    },
    yearReportRealizations: {
        description: 'Every sale in the Year report and the purchase lot it was matched with first in, first out: when and at what price each was bought, sold, and the profit or loss.',
        report: 'year',
        load: (args, reports) => reports.year(args).then((report) => report.realizations),
        tokens: (row) => [row.token, row.symbol],
    },
    portfolioHoldings: {
        description: 'The Portfolio page: each token held now, its value, cost basis and unrealized result, its realized result since fromDate, and what it held at fromDate.',
        report: 'portfolio',
        load: (args, reports) => reports.portfolio(args).then((report) => report.holdings),
        tokens: (row) => [row.token, row.symbol],
    },
    balanceCheck: {
        description: 'Each token of an account, its stored final balance next to the chain: current, behind (moved since the stored data ends), wrong (the chain never held it), unknown, or not stored (held now with no stored row).',
        report: 'balances',
        load: (args, reports) => reports.balances(args).then((report) => report.rows),
        tokens: (row) => [row.token],
    },
};

const REPORT_PARAMS = { year: yearReportParams, portfolio: portfolioParams, balances: balanceCheckParams };
const NEEDS = { year: ['year', 'currency'], portfolio: ['currency', 'fromDate'], balances: ['account'] };

const getPath = (row, path) => path.split('.').reduce((value, key) => value?.[key], row);

/** Milliseconds from the store's timestamp spellings: nanosecond strings, ISO dates, plain dates. */
function timeOf(row) {
    const value = row.block_timestamp ?? row.createdAt ?? row.timestamp ?? row.date;
    if (value === undefined || value === null) return null;
    if (/^\d{16,}$/.test(String(value))) return Number(BigInt(value) / 1_000_000n);
    if (typeof value === 'number') return value;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
}

const asTime = (value, name) => {
    const parsed = typeof value === 'number' ? value : Date.parse(value);
    if (Number.isNaN(parsed)) throw new Error(`${name} is not a date: ${value}`);
    return parsed;
};

const isDigits = (value) => typeof value === 'string' && /^-?\d+$/.test(value);

// Balances are integer strings too large for a Number.
function compare(a, b) {
    if ((isDigits(a) || Number.isInteger(a)) && (isDigits(b) || Number.isInteger(b))) {
        const [x, y] = [BigInt(a), BigInt(b)];
        return x < y ? -1 : x > y ? 1 : 0;
    }
    if (typeof a === 'number' && !Number.isNaN(Number(b))) return a - Number(b);
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

const CONDITIONS = {
    '=': (a, b) => a !== undefined && a !== null && compare(a, b) === 0,
    '!=': (a, b) => a === undefined || a === null || compare(a, b) !== 0,
    '<': (a, b) => a !== undefined && a !== null && compare(a, b) < 0,
    '<=': (a, b) => a !== undefined && a !== null && compare(a, b) <= 0,
    '>': (a, b) => a !== undefined && a !== null && compare(a, b) > 0,
    '>=': (a, b) => a !== undefined && a !== null && compare(a, b) >= 0,
    contains: (a, b) => String(a ?? '').includes(String(b)),
    missing: (a) => a === undefined || a === null,
};

const toSummable = (value) => (isDigits(value) || Number.isInteger(value) ? BigInt(value) : Number(value));
const METRICS = {
    sum: (total, value) => {
        const next = toSummable(value);
        if (total === undefined) return next;
        return typeof total === 'bigint' && typeof next === 'bigint' ? total + next : Number(total) + Number(next);
    },
    min: (best, value) => (best === undefined || compare(value, best) < 0 ? value : best),
    max: (best, value) => (best === undefined || compare(value, best) > 0 ? value : best),
    first: (kept, value) => kept ?? value,
    last: (_, value) => value,
};

function buildFilter({ dataset, token, from, to, where = [] }) {
    if (!Array.isArray(where)) throw new Error('where must be a list of [field, condition, value]');
    for (const [field, condition] of where) {
        if (typeof field !== 'string') throw new Error('where: a field name must be a string');
        if (!Object.hasOwn(CONDITIONS, condition)) {
            throw new Error(`where: unknown condition ${condition} (one of ${Object.keys(CONDITIONS).join(', ')})`);
        }
    }
    const fromMs = from === undefined ? null : asTime(from, 'from');
    const toMs = to === undefined ? null : asTime(to, 'to');
    return (row) => {
        if (token !== undefined && !dataset.tokens(row).includes(token)) return false;
        if (fromMs !== null || toMs !== null) {
            const time = timeOf(row);
            if (time === null || (fromMs !== null && time < fromMs) || (toMs !== null && time > toMs)) return false;
        }
        return where.every(([field, condition, value]) => CONDITIONS[condition](getPath(row, field), value));
    };
}

function shortened(value) {
    if (typeof value === 'string') {
        return value.length > MAX_SAMPLE_VALUE_CHARS ? `${value.slice(0, MAX_SAMPLE_VALUE_CHARS)}…` : value;
    }
    if (Array.isArray(value)) return `[${value.length} items]`;
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shortened(inner)]));
    }
    return value;
}

function fieldNames(rows) {
    const names = new Set();
    for (const row of rows.slice(0, 200)) {
        for (const [key, value] of Object.entries(row)) {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                for (const inner of Object.keys(value)) names.add(`${key}.${inner}`);
            } else {
                names.add(key);
            }
        }
    }
    return [...names].slice(0, MAX_FIELD_NAMES);
}

const accountsChange = (accountId) => ({
    validate: () => {
        if (!ACCOUNT_ID.test(accountId ?? '')) throw new Error(`not a valid NEAR account: ${accountId}`);
    },
    read: async () => ((await exists(accountsconfigfile)) ? await getAccounts() : []),
});

// Every change the agent may ask for. Transaction data is not here: it comes from
// a fetch, and the next sync would overwrite an edit.
// The price refresh counts; the page wants a sentence.
const priceProgress = (progress) => (done, total, token, currency) => progress(token
    ? `Updating prices: ${token} in ${currency} (${done + 1} of ${total})`
    : `Updated ${total} price histories`);

const CHANGES = {
    addAccount: {
        describe: ({ accountId }) => `Track the account ${accountId}`,
        check: async ({ accountId }) => {
            const change = accountsChange(accountId);
            change.validate();
            if ((await change.read()).includes(accountId)) throw new Error(`${accountId} is already tracked`);
        },
        apply: async ({ accountId }) => setAccounts([...await accountsChange(accountId).read(), accountId]),
    },
    excludeToken: {
        describe: ({ contractId, symbol, reason }) => `Leave ${symbol ?? contractId} out of the year report${reason ? ` (${reason})` : ''}`,
        check: async ({ contractId, symbol, reason }) => {
            if (!CONTRACT_ID.test(contractId ?? '')) throw new Error(`not a valid token contract: ${contractId}`);
            if (symbol !== undefined && (typeof symbol !== 'string' || symbol.length > 64)) throw new Error('symbol must be a short string');
            if (reason !== undefined && (typeof reason !== 'string' || reason.length > 200)) throw new Error('reason must be a short string');
            if (isExcluded(await getTokenExclusions(), contractId, symbol)) throw new Error(`${contractId} is already excluded`);
        },
        apply: ({ contractId, symbol, reason }) => excludeToken({ contractId, symbol }, reason),
    },
    includeToken: {
        describe: ({ contractId }) => `Put ${contractId} back in the year report`,
        check: async ({ contractId }) => {
            if (!CONTRACT_ID.test(contractId ?? '')) throw new Error(`not a valid token contract: ${contractId}`);
            if (!(await getTokenExclusions()).excluded.some((token) => token.contractId === contractId)) {
                throw new Error(`${contractId} is not excluded`);
            }
        },
        apply: ({ contractId }) => includeToken(contractId),
    },
    removeAccount: {
        describe: ({ accountId }) => `Stop tracking ${accountId}. Its stored data stays in the repository`,
        check: async ({ accountId }) => trackedAccount(accountId),
        apply: async ({ accountId }) => setAccounts((await accountsChange(accountId).read()).filter((account) => account !== accountId)),
    },
    fetchTransactions: {
        describe: ({ accounts }) => `Fetch the transactions of ${accounts.join(', ')} from the Ariz gateway, merge them into the store, then update prices. `
            + 'Free for an account the gateway already keeps up to date. For one it does not, you become its payer, billed in ARIZ for keeping it synced',
        check: async ({ accounts }) => {
            if (!Array.isArray(accounts) || accounts.length === 0) throw new Error('accounts must be a list of the portfolio\'s accounts');
            for (const account of accounts) await trackedAccount(account);
        },
        apply: async ({ accounts }, progress) => {
            const result = await fetchAccountsFromExport(accounts, { onProgress: progress, onPriceProgress: priceProgress(progress) });
            return {
                fetched: result.fetched,
                pricesUpdated: result.pricesUpdated,
                pricesFailed: result.pricesFailed.length,
            };
        },
    },
    fetchConfidentialHistory: {
        describe: ({ accountId }) => `Fetch the confidential intents history of ${accountId}. Your wallet asks you to sign as ${accountId}. It is stored in your repository only`,
        check: async ({ accountId }) => trackedAccount(accountId),
        apply: async ({ accountId }, progress) => {
            const { fetched, total, added, updated, mismatches } = await fetchConfidentialForAccount(accountId, { onProgress: progress });
            return {
                fetched, total, added, updated,
                balancesMatchTheLedger: mismatches.length === 0,
                mismatches: mismatches.slice(0, 20).map((m) => ({ asset: m.symbol ?? m.assetId, derived: String(m.derived), actual: String(m.actual) })),
            };
        },
    },
    refreshPrices: {
        describe: () => 'Update the stored price histories from the Ariz gateway',
        check: async () => { },
        apply: async (args, progress) => {
            const result = await refreshStoredPriceHistories(priceProgress(progress));
            return { updated: result.updated, failed: result.failed.length };
        },
    },
    setCounterparty: {
        describe: ({ account, category, description }) => ({
            none: `Make ${account} an ordinary counterparty again, neither received nor expense`,
            received: `Count what ${account} sends you as received income`,
            expense: `Count what you pay ${account} as an expense`,
        }[category] + (description ? ` (${description})` : '')),
        check: async ({ account, category, description }) => {
            if (!ACCOUNT_ID.test(account ?? '')) throw new Error(`not a valid NEAR account: ${account}`);
            if (!['received', 'expense', 'none'].includes(category)) throw new Error('category must be received, expense or none');
            if (description !== undefined && (typeof description !== 'string' || description.length > 200)) throw new Error('description must be a short string');
        },
        // A counterparty is one or the other, as on the Counterparties page.
        apply: async ({ account, category, description = '' }) => {
            const received = await getReceivedAccounts();
            const expense = await getExpenseAccounts();
            delete received[account];
            delete expense[account];
            if (category === 'received') received[account] = { description };
            if (category === 'expense') expense[account] = { description };
            await setReceivedAccounts(received);
            await setExpenseAccounts(expense);
        },
    },
    openPage: {
        describe: ({ page, year, currency }) => (page === 'year-summary-print'
            ? `Open the printable Year report summary for ${year} in ${String(currency).toUpperCase()} in a new tab`
            : `Open the ${page} page in a new tab`),
        check: async (args) => { pagePath(args); },
        apply: async (args) => {
            // Beside this page, wherever the app is served from.
            const url = new URL(pagePath(args), new URL('.', location.href));
            if (!window.open(url, '_blank', 'noopener')) throw new Error('the browser blocked the new tab');
            return { opened: url.pathname + url.search };
        },
    },
};

// Pages the assistant may open for the user, in a new tab so the conversation
// stays. Storage is here rather than a sync action: syncing is the Storage
// page's own guided flow, with its key unlock and signatures.
const PAGES = ['portfolio', 'year-report', 'transactions', 'staking', 'counterparties', 'accounts', 'storage', 'arizcredits'];

function pagePath({ page, year, currency } = {}) {
    if (page === 'year-summary-print') {
        const { year: y, currency: c } = yearReportParams({ year, currency });
        return `yearsummary-alltokens-print?year=${y}&month=0&nummonths=12&currency=${c}`;
    }
    if (!PAGES.includes(page)) throw new Error(`page must be one of ${[...PAGES, 'year-summary-print'].join(', ')}`);
    return page;
}

async function trackedAccount(accountId) {
    if (!ACCOUNT_ID.test(accountId ?? '')) throw new Error(`not a valid NEAR account: ${accountId}`);
    if (!(await accountsChange(accountId).read()).includes(accountId)) throw new Error(`${accountId} is not one of the portfolio's accounts`);
}

/** One agent session: what it has read so far, and the changes waiting for the user. */
/**
 * @param {object} [options]
 * @param {(message: string) => void} [options.onProgress] what a long call is
 *   waiting for right now, for the page to show while it waits
 */
export function createDataSession({ onProgress = () => { } } = {}) {
    const loaded = new Map();
    let lastFilter = null;
    const pending = new Map();
    let nextChangeId = 1;
    const reports = createReports({ progress: (message) => onProgress(message) });

    function datasetFor({ dataset: name, account }) {
        if (!Object.hasOwn(DATASETS, name ?? '')) {
            throw new Error(`unknown dataset ${name} (one of ${Object.keys(DATASETS).join(', ')})`);
        }
        const dataset = DATASETS[name];
        if (dataset.perAccount && !ACCOUNT_ID.test(account ?? '')) throw new Error(`${name} needs a valid account, got ${account}`);
        return dataset;
    }

    /** Which rows a dataset means: the account, or the report's checked parameters. */
    function scopeOf(args) {
        const dataset = datasetFor(args);
        if (dataset.report) return REPORT_PARAMS[dataset.report](args);
        return dataset.perAccount ? { account: args.account } : {};
    }

    // A dataset is parsed once a session, so paging through it is not a parse per page.
    function rowsOf(args) {
        const dataset = datasetFor(args);
        const scope = scopeOf(args);
        const key = JSON.stringify([args.dataset, scope]);
        if (!loaded.has(key)) {
            loaded.set(key, Promise.resolve(dataset.load(scope, reports)).catch((error) => {
                loaded.delete(key);
                throw dataset.report ? error : new Error(`the stored ${args.dataset} data could not be read, run checkData (${error?.name ?? 'error'})`);
            }));
        }
        return loaded.get(key);
    }

    async function matching(args) {
        const dataset = datasetFor(args);
        const key = JSON.stringify([args.dataset, scopeOf(args), args.token, args.from, args.to, args.where]);
        if (lastFilter?.key !== key) {
            const rows = await rowsOf(args);
            lastFilter = { key, rows: rows.filter(buildFilter({ ...args, dataset })) };
        }
        return lastFilter.rows;
    }

    const api = {
        listDatasets: async () => Object.entries(DATASETS).map(([name, { description, perAccount, report }]) =>
            ({ dataset: name, description, needs: report ? NEEDS[report] : perAccount ? ['account'] : [] })),

        /**
         * The Year report's totals for a year and currency, every token together,
         * and what was left out of them and why. The same figures as the page.
         */
        yearReport: async (args = {}) => (await reports.year(args)).summary,

        /** The Portfolio page's figures: holdings now, and the change since fromDate. */
        portfolio: async (args = {}) => (await reports.portfolio(args)).summary,

        /**
         * Whether an account's stored history ends where the chain is: per token,
         * current, behind or wrong, and what is held now with no stored row.
         */
        balanceCheck: async (args = {}) => (args.account === undefined ? reports.allBalances() : (await reports.balances(args)).summary),

        /** The shape of a dataset, whatever its size. */
        describe: async (args = {}) => {
            const dataset = datasetFor(args);
            const rows = await rowsOf(args);
            const times = rows.map(timeOf).filter((time) => time !== null);
            const tokens = new Map();
            for (const row of rows) {
                for (const token of new Set(dataset.tokens(row).filter(Boolean))) tokens.set(token, (tokens.get(token) ?? 0) + 1);
            }
            const toJson = (ms) => new Date(ms).toJSON();
            return {
                dataset: args.dataset,
                rows: rows.length,
                firstEntry: times.length ? toJson(times.reduce((a, b) => Math.min(a, b))) : null,
                lastEntry: times.length ? toJson(times.reduce((a, b) => Math.max(a, b))) : null,
                tokenCount: tokens.size,
                tokens: [...tokens].sort((a, b) => b[1] - a[1]).slice(0, MAX_LISTED_TOKENS).map(([token, count]) => ({ token, rows: count })),
                fields: fieldNames(rows),
                sample: rows.length ? [rows[0], rows[rows.length - 1]].slice(0, rows.length).map(shortened) : [],
            };
        },

        /**
         * One page of matching rows. `where` is a list of [field, condition, value],
         * with dotted fields for nested values; `fields` picks what each row carries.
         * The second argument is not reachable from a script: it sets the budget.
         */
        query: async (args = {}, { maxBytes = SCRIPT_PAGE_BYTES } = {}) => {
            const rows = await matching(args);
            const limit = Math.min(Math.max(1, Number(args.limit) || DEFAULT_QUERY_LIMIT), MAX_QUERY_LIMIT);
            let position = Math.max(0, Number(args.cursor) || 0);
            const page = [];
            let bytes = 0;
            while (position < rows.length && page.length < limit) {
                let row = rows[position];
                if (args.fields) row = Object.fromEntries(args.fields.map((field) => [field, getPath(row, field)]));
                const size = JSON.stringify(row).length;
                if (bytes + size > maxBytes) {
                    if (page.length) break;
                    // One row over the whole budget still has to move the cursor on.
                    row = { omitted: `this row is ${size} characters: ask for fewer fields` };
                }
                page.push(row);
                bytes += JSON.stringify(row).length;
                position++;
            }
            return { rows: page, matching: rows.length, nextCursor: position < rows.length ? position : null };
        },

        /**
         * Totals over every matching row, computed here so a large dataset does
         * not have to pass through a script. Integer strings sum exactly.
         * `metrics` maps a result name to [sum|min|max|first|last, field].
         */
        aggregate: async (args = {}) => {
            const rows = await matching(args);
            const groupBy = args.groupBy ?? [];
            const metrics = Object.entries(args.metrics ?? {});
            for (const [name, spec] of metrics) {
                if (!Array.isArray(spec) || !Object.hasOwn(METRICS, spec[0]) || typeof spec[1] !== 'string') {
                    throw new Error(`metric ${name} must be [${Object.keys(METRICS).join('|')}, field]`);
                }
            }
            const groups = new Map();
            for (const row of rows) {
                const keys = groupBy.map((field) => getPath(row, field));
                const key = JSON.stringify(keys);
                let group = groups.get(key);
                if (!group) {
                    if (groups.size >= MAX_GROUPS) throw new Error(`more than ${MAX_GROUPS} groups: group by less, or filter first`);
                    group = { keys, count: 0, values: metrics.map(() => undefined) };
                    groups.set(key, group);
                }
                group.count++;
                metrics.forEach(([, [metric, field]], index) => {
                    const value = getPath(row, field);
                    if (value !== undefined && value !== null) group.values[index] = METRICS[metric](group.values[index], value);
                });
            }
            return {
                matching: rows.length,
                groups: [...groups.values()].map(({ keys, count, values }) => ({
                    ...Object.fromEntries(groupBy.map((field, index) => [field, keys[index]])),
                    count,
                    ...Object.fromEntries(metrics.map(([name], index) => [name, typeof values[index] === 'bigint' ? String(values[index]) : values[index]])),
                })),
            };
        },

        /**
         * Where a token's stored balance does not continue from its previous row,
         * over every row. It runs here because a script must split a large dataset,
         * and a scan split by hand can lose the very rows where a break is.
         */
        balanceBreaks: async ({ account, token, from, to } = {}) => {
            const rows = await matching({ dataset: 'records', account, token, from, to });
            const ordered = rows.map((row, index) => ({ row, index }))
                .sort((a, b) => (a.row.block_height - b.row.block_height) || (a.index - b.index));
            const previous = new Map();
            const breaks = [];
            let breakCount = 0;
            let unreadable = 0;
            for (const { row } of ordered) {
                if (!isDigits(row.balance_before) || !isDigits(row.balance_after)) {
                    unreadable++;
                    continue;
                }
                const expected = previous.get(row.token_id);
                if (expected !== undefined && expected !== BigInt(row.balance_before)) {
                    breakCount++;
                    if (breaks.length < MAX_LISTED_BREAKS) {
                        breaks.push({
                            token: row.token_id, block_height: row.block_height, block_timestamp: row.block_timestamp, tx_hash: row.tx_hash,
                            expected: String(expected), found: row.balance_before, difference: String(BigInt(row.balance_before) - expected),
                        });
                    }
                }
                previous.set(row.token_id, BigInt(row.balance_after));
            }
            return { checkedRows: rows.length, tokens: previous.size, unreadableRows: unreadable, breakCount, breaks };
        },

        /** Whether each stored file can be read, and which accounts have data. */
        checkData: () => checkStoreFiles(),

        /** Validate a change and queue it for the user. Nothing is written. */
        proposeChange: async ({ op, args = {} } = {}) => {
            if (!Object.hasOwn(CHANGES, op ?? '')) throw new Error(`unknown change ${op} (one of ${Object.keys(CHANGES).join(', ')})`);
            await CHANGES[op].check(args);
            const id = nextChangeId++;
            pending.set(id, { id, op, args, summary: CHANGES[op].describe(args) });
            return { id, summary: pending.get(id).summary, status: 'waiting for the user to approve' };
        },
    };

    return {
        api,
        pendingChanges: () => [...pending.values()],
        rejectChange: (id) => pending.delete(id),
        /** For the UI, on the user's say. Checked again: the store may have moved on. */
        applyChange: async (id) => {
            const change = pending.get(id);
            if (!change) throw new Error(`no pending change ${id}`);
            // A fetch takes a while, and a second click must not run it twice.
            if (change.applying) throw new Error(`change ${id} is already being applied`);
            change.applying = true;
            try {
                await CHANGES[change.op].check(change.args);
                const result = await CHANGES[change.op].apply(change.args, (message) => onProgress(message));
                pending.delete(id);
                return result ?? null;
            } finally {
                change.applying = false;
                // Whatever got written: an exclusion changes the year report, a
                // fetch or an account changes everything.
                loaded.clear();
                reports.clear();
                lastFilter = null;
            }
        },
    };
}
