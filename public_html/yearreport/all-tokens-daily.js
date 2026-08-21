// Combining every token's daily figures into one row per day.
//
// The year report is per token, which is right for cost basis — each token has
// its own FIFO lots — and useless for the question "what did I actually put in
// on the 14th?". That answer is spread across as many tables as there are
// tokens, in units that cannot be added together.
//
// Converted to one currency they can be. This is the surface that makes the
// flow decomposition checkable: the same deposits and withdrawals, per day,
// with the transactions behind them.
//
// Pure. The caller does the I/O and hands over what each token contributed.

/** The token-selector value that means "all of them". Not a contract id. */
export const ALL_TOKENS = '__all__';

/**
 * @typedef {object} TokenDay  one token's contribution to one date, already
 *   converted to the display currency
 * @property {string} token
 * @property {string} symbol
 * @property {string} date
 * @property {number} stakingReward
 * @property {number} received
 * @property {number} deposit
 * @property {number} withdrawal
 * @property {number} expense
 * @property {number} [profit]
 * @property {number} [loss]
 * @property {number} [totalBalance]   value held at the end of the day
 * @property {number} [totalChange]
 * @property {number} [accountBalance]  liquid part of it; a fungible token is
 *   all liquid, so only NEAR ever splits
 * @property {number} [accountChange]
 * @property {number} [stakingBalance]
 * @property {number} [stakingChange]
 * @property {boolean} [priced]  false when no rate was available that day
 */

const SUMMED = ['stakingReward', 'received', 'deposit', 'withdrawal', 'expense',
    'profit', 'loss', 'totalBalance', 'totalChange',
    'accountBalance', 'accountChange', 'stakingBalance', 'stakingChange'];

/**
 * One row per date, summing every token that contributed to it.
 *
 * @param {TokenDay[]} contributions
 * @returns {{rows: Array, totals: object}} rows newest first, each carrying the
 *   per-token breakdown that produced it and the symbols that could not be
 *   priced that day
 */
export function combineDailyRows(contributions) {
    const byDate = new Map();
    for (const c of contributions) {
        if (!c?.date) continue;
        if (!byDate.has(c.date)) {
            byDate.set(c.date, {
                date: c.date,
                ...Object.fromEntries(SUMMED.map(k => [k, 0])),
                tokens: [],
                unpriced: [],
                unvalued: [],
            });
        }
        const row = byDate.get(c.date);
        // An unpriced token is recorded, not silently added as zero: a day whose
        // total is missing a leg should say so rather than look complete.
        if (c.priced === false) {
            // Split by what the missing price actually costs you: a movement that
            // cannot be priced makes the day's flows wrong, a balance that cannot
            // be priced only makes the balance short. Both are said, not equally
            // loudly — a token that merely sits there unpriced would otherwise put
            // a warning on every day of the year and bury the days that moved.
            const list = c.movedUnits ? row.unpriced : row.unvalued;
            if (!list.includes(c.symbol)) list.push(c.symbol);
        } else {
            for (const k of SUMMED) row[k] += Number(c[k] ?? 0);
        }
        if (hasMovement(c)) row.tokens.push(c);
    }

    const rows = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
    for (const row of rows) {
        row.tokens.sort((a, b) => movementSize(b) - movementSize(a));
        row.net = row.deposit + row.received - row.withdrawal - row.expense;
    }

    const totals = Object.fromEntries(SUMMED.map(k => [k, 0]));
    for (const row of rows) for (const k of SUMMED) totals[k] += row[k];
    totals.net = totals.deposit + totals.received - totals.withdrawal - totals.expense;
    totals.days = rows.length;
    totals.unpriced = [...new Set(rows.flatMap(r => r.unpriced))];
    totals.unvalued = [...new Set(rows.flatMap(r => r.unvalued))];

    return { rows, totals };
}

/** Did anything actually move for this token on this day? */
function hasMovement(c) {
    return c.priced === false
        || movementSize(c) > 0
        || Number(c.profit ?? 0) !== 0
        || Number(c.loss ?? 0) !== 0;
}

function movementSize(c) {
    return Math.abs(Number(c.deposit ?? 0)) + Math.abs(Number(c.received ?? 0))
        + Math.abs(Number(c.withdrawal ?? 0)) + Math.abs(Number(c.expense ?? 0))
        + Math.abs(Number(c.stakingReward ?? 0));
}

/**
 * Days worth putting in front of someone. A year of rows is mostly days where
 * nothing happened; the ones that matter are the ones that moved.
 */
export function daysWithActivity(rows) {
    return rows.filter(r => r.tokens.length > 0 || r.unpriced.length > 0 || r.unvalued.length > 0);
}
