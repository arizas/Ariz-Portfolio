// Turning the year report's daily balances into the movements
// flow-decomposition.js consumes.
//
// The year report runs per token, so one swap arrives as two separate entries —
// a withdrawal in one token's pass, a deposit in another's — and the only thing
// linking them is the transaction hash. That hash is why `dailyBalances` carries
// `flows` at all; the daily `deposit` / `withdrawal` totals cannot be
// reassembled into swaps once summed.
//
// Pure: prices are the caller's problem.

import { CONFIDENTIAL_TOKEN_PREFIX } from '../near/intents-tokens.js';

/**
 * The handle that ties two legs of one swap together.
 *
 * On chain that is the transaction hash. A confidential swap has no on-chain
 * hash, so confidentialledger.js synthesises one per movement as
 * `confidential:<depositAddress>:<direction>` — which differs between the two
 * legs by its suffix. Stripping the direction leaves the deposit address, which
 * both legs share.
 */
export function swapKeyForHash(hash) {
    if (typeof hash !== 'string') return hash;
    if (!hash.startsWith(CONFIDENTIAL_TOKEN_PREFIX)) return hash;
    const cut = hash.lastIndexOf(':');
    return cut > CONFIDENTIAL_TOKEN_PREFIX.length ? hash.slice(0, cut) : hash;
}

/**
 * Movements for one token, from its year-report daily balances.
 *
 * @param {object} args
 * @param {string} args.token contract id
 * @param {string} [args.symbol]
 * @param {object} args.dailyBalances from calculateYearReportData
 * @param {number} args.decimalConversionValue raw units -> token units
 * @param {(account: string) => 'income'|'yield'} [args.classifyReceived]
 *   what a counterparty's payments are. Defaults to income — see
 *   docs/performance-comparison.md §3: a comparison should err toward
 *   flattering the benchmark, never its owner.
 * @param {string} [args.from] inclusive 'YYYY-MM-DD'
 * @param {string} [args.to] inclusive
 * @returns {import('./flow-decomposition.js').Movement[]}
 */
export function movementsForToken({
    token,
    symbol,
    dailyBalances,
    decimalConversionValue,
    classifyReceived = () => 'income',
    from,
    to,
}) {
    const out = [];
    for (const date of Object.keys(dailyBalances).sort()) {
        if (from && date < from) continue;
        if (to && date > to) continue;
        const day = dailyBalances[date];
        if (!day) continue;

        // Deposits and withdrawals, one entry per transaction so swaps survive.
        for (const flow of day.flows ?? []) {
            const units = flow.changed * decimalConversionValue;
            if (units === 0) continue;
            out.push({
                date,
                token,
                symbol,
                units: Math.abs(units),
                kind: units > 0 ? 'deposit' : 'withdrawal',
                swapKey: swapKeyForHash(flow.hash),
                counterparties: flow.counterparties ?? [],
                at: flow.at,
            });
        }

        // Income and yield, split by who sent it.
        for (const entry of day.receivedFrom ?? []) {
            const units = entry.amount * decimalConversionValue;
            if (units === 0) continue;
            out.push({
                date,
                token,
                symbol,
                units: Math.abs(units),
                kind: classifyReceived(entry.account),
            });
        }

        // Spend leaving the portfolio. No classification needed: it is an
        // outflow whatever the counterparty is.
        const expense = Number(day.expense ?? 0) * decimalConversionValue;
        if (expense !== 0) {
            out.push({ date, token, symbol, units: Math.abs(expense), kind: 'expense' });
        }
    }
    return out;
}

/**
 * Read `receivedaccounts` into a classifier. An entry with no `type` is income,
 * which is both today's behaviour and the safer default.
 */
export function receivedClassifier(receivedAccounts = {}) {
    return account => (receivedAccounts[account]?.type === 'yield' ? 'yield' : 'income');
}

/**
 * Shipped classifications under the user's own, merged field by field.
 *
 * Replacing whole entries looked equivalent and was not. A user who has
 * `distribution.nearmobile.near` saved with a description and no type — which is
 * how the account gets counted as received at all — replaced the shipped
 * `type: 'yield'` with nothing, and their NPRO staking rewards were booked as
 * money they added. The default could therefore never apply to anyone it was
 * written for.
 */
export function mergedReceivedTypes(stored = {}, defaults = DEFAULT_RECEIVED_TYPES) {
    const out = { ...defaults };
    for (const [account, entry] of Object.entries(stored)) {
        out[account] = { ...defaults[account], ...entry };
    }
    return out;
}

/** Known payers whose transfers are yield, not income, shipped pre-classified. */
export const DEFAULT_RECEIVED_TYPES = {
    // NPRO is distributed daily for staking in the NPRO pool — a different token
    // from the one staked, but still return on capital already held.
    'distribution.nearmobile.near': { type: 'yield', description: 'NPRO staking rewards' },
};
