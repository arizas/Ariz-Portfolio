// Where the money came from.
//
// A portfolio that went from 155 541 to 303 974 either doubled or was topped
// up, and the page currently cannot tell you which. This splits the change:
//
//     opening  +  net flows  +  gain  =  closing
//
// "Flows" are only what crossed the portfolio boundary. A swap is not a flow —
// it is the same money in a different token — and neither is yield on holdings
// already inside. Both belong in `gain`, which is the part you earned.
//
// Everything here is pure. The caller extracts movements from the year report's
// dailyBalances and supplies a price lookup; nothing is fetched, cached or
// stored. See docs/performance-comparison.md §0.

import { separatePortfolioTransfers } from './portfolio-transfers.js';

/** A movement's sign: does it bring value in, or take it out? */
const INFLOW = new Set(['deposit', 'income']);
const OUTFLOW = new Set(['withdrawal', 'expense']);

/**
 * @typedef {object} Movement
 * @property {string} date   'YYYY-MM-DD'
 * @property {string} token  contract id, the key the price lookup takes
 * @property {string} [symbol]
 * @property {number} units  always positive; direction comes from `kind`
 * @property {'deposit'|'withdrawal'|'income'|'yield'} kind
 * @property {string} [swapKey] transaction hash, or a confidential deposit
 *   address — the handle that ties two legs of one swap together
 */

/**
 * Split a change in portfolio value into flows and gain.
 *
 * @param {object} args
 * @param {Movement[]} args.movements
 * @param {(token: string, date: string) => number|null} args.price
 *   value of one unit in the display currency, or null if unknown
 * @param {number} args.opening  portfolio value at the start, display currency
 * @param {number} args.closing  portfolio value now, display currency
 * @param {object} [args.fifo]  independent figures to reconcile against —
 *   `{ realized, unrealizedNow, unrealizedOpening }` from calculatePortfolio
 * @param {Set<string>} [args.neverPriced]  tokens with no market anywhere
 * @param {number} [args.swapTolerance]  how far a swap's two legs may differ
 *   in end-of-day value before the pair is treated as suspect
 * @param {number} [args.dustFraction]  a leg smaller than this share of the
 *   largest leg in its transaction is a cost, not a side of a trade
 * @param {(token: string, units: number) => number|null} [args.estimateValue]
 *   an upper bound on what an unpriceable movement could be worth — today's
 *   price is enough, since the question is only whether it could matter
 * @param {number} [args.materialityFloor]  as a fraction of `closing`
 * @param {number} [args.reconcileTolerance]  as a fraction of `closing`
 * @returns {object} see below; `ok: false` when it refuses to guess
 */
export function decomposeFlows({
    movements = [],
    price,
    opening = 0,
    closing = 0,
    fifo = null,
    neverPriced = new Set(),
    swapTolerance = 0.25,
    dustFraction = 0.01,
    reconcileTolerance = 0.01,
    estimateValue = null,
    materialityFloor = 0.001,
}) {
    // A token with no market anywhere has no value to move across the boundary,
    // so it contributes nothing. This is not a guess, and it is what stops a
    // worthless airdrop from vetoing the whole calculation — quite different
    // from a real asset missing a price on one day, which must refuse.
    const ignoredNoMarket = [];
    const live = movements.filter(m => {
        if (!neverPriced.has(m.token)) return true;
        if (!ignoredNoMarket.includes(m.token)) ignoredNoMarket.push(m.token);
        return false;
    });

    const { internal, external: crossedOrMoved, suspect, costs } =
        separateSwaps(live, price, swapTolerance, dustFraction);

    // A swap is not the only way to move value without any of it leaving. The
    // same asset carried from one bucket to another — native, intents,
    // confidential — arrives as a withdrawal in one token's pass and a deposit
    // in another's, under two different transactions, so the hash cannot tie
    // them together. See portfolio-transfers.js.
    const { internal: transfers, external } = separatePortfolioTransfers(crossedOrMoved);

    // Price what is left. A missing price here is refused rather than treated as
    // zero: the value is real and unknown, and a wrong flow shifts everything
    // downstream permanently.
    const unpriced = [];
    let deposits = 0, withdrawals = 0, income = 0, earned = 0;
    for (const m of external) {
        const p = price(m.token, m.date);
        if (p == null || !Number.isFinite(p)) {
            unpriced.push({ token: m.token, symbol: m.symbol, date: m.date, units: m.units });
            continue;
        }
        const value = m.units * p;
        if (m.kind === 'deposit') deposits += value;
        else if (m.kind === 'income') income += value;
        else if (m.kind === 'withdrawal') withdrawals += value;
        else if (m.kind === 'expense') withdrawals += value;
        else if (m.kind === 'yield') earned += value;
    }

    // Refusing is right when the unknown value could move the answer. It is not
    // right when it cannot: a movement worth two kroner should not stop a
    // decomposition of three hundred thousand, and price history that lags the
    // last few days is a common reason for one to be unpriceable.
    //
    // So bound it rather than guess it. Today's price times the units is an
    // upper bound on what a recent movement could be worth, and if everything
    // unpriceable together stays under the floor, it is reported and skipped
    // instead of blocking the answer.
    let immaterial = [];
    if (unpriced.length && estimateValue) {
        let bound = 0;
        let bounded = true;
        for (const u of unpriced) {
            const est = estimateValue(u.token, u.units);
            if (est == null || !Number.isFinite(est)) { bounded = false; break; }
            bound += Math.abs(est);
        }
        const allowed = Math.max(Math.abs(closing), 1) * materialityFloor;
        if (bounded && bound <= allowed) {
            immaterial = unpriced.map(u => ({ ...u, estimatedValue: estimateValue(u.token, u.units) }));
            unpriced.length = 0;
        }
    }

    if (unpriced.length) {
        return { ok: false, reason: 'unpriced-flows', unpriced, ignoredNoMarket, suspect };
    }
    if (suspect.length) {
        return { ok: false, reason: 'ambiguous-swap', suspect, ignoredNoMarket };
    }

    // Yield is deliberately absent: it is return on capital already inside, so
    // it belongs to `gain`, which closing already carries.
    const netFlow = deposits + income - withdrawals;
    const gain = closing - opening - netFlow;

    return {
        ok: true,
        opening,
        closing,
        deposits,
        withdrawals,
        income,
        yieldReceived: earned,
        netFlow,
        gain,
        internal,
        transfers,
        transactionCosts: costs,
        ignoredNoMarket,
        immaterial,
        reconciliation: reconcile({ gain, earned, closing, fifo, reconcileTolerance }),
    };
}

/**
 * Split movements into the ones that only moved money around inside the
 * portfolio and the ones that crossed its edge.
 *
 * A swap shows up as a withdrawal in one token's pass and a deposit in
 * another's, tied together by the transaction hash. Cancelling those by value
 * does not work: prices are end-of-day, the swap executed intraday, and the
 * difference left over is the intraday move — real performance, which would
 * otherwise be booked as a deposit nobody made.
 *
 * So the pair is recognised by its key and removed whole. The values are then
 * *checked* rather than trusted: a batched transaction can carry a swap and a
 * genuine transfer under one hash, and a leg can be mispriced. Either way the
 * two sides will not match, and that has to be surfaced instead of netted away.
 *
 * The tolerance has to be generous, because the gap it measures is mostly the
 * legitimate intraday move. A real swap on 2026-07-21 shows a 5.3 % gap at
 * end-of-day prices with nothing wrong with it; a batched transaction carrying a
 * genuine transfer will typically be out by most of its value. 25 % sits well
 * clear of the first and well under the second.
 *
 * Exported because the same question — did this money leave the portfolio, or
 * only change token inside it? — is asked per day by the combined year report.
 * One classification, so the two views cannot disagree about what a swap is.
 *
 * @returns {{internal: object[], external: Movement[], suspect: object[], costs: object[]}}
 *   `internal` and `suspect` are one entry per transaction, each carrying the
 *   legs it was decided from in `movements`.
 */
export function separateSwaps(movements, price, tolerance = 0.25, dustFraction = 0.01) {
    const groups = new Map();
    const external = [];
    for (const m of movements) {
        if (!m.swapKey) { external.push(m); continue; }
        if (!groups.has(m.swapKey)) groups.set(m.swapKey, []);
        groups.get(m.swapKey).push(m);
    }

    const internal = [];
    const suspect = [];
    const costs = [];
    for (const [key, all] of groups) {
        // Every transaction that moves a token also moves native NEAR, by the
        // gas it burned and the unused portion it refunded. Those specks share
        // the hash, so a plain transfer arrives looking like a trade with one
        // side worth nothing — which is how 46 ordinary transfers came to be
        // reported as swaps that did not balance.
        //
        // Gas is a cost of transacting, not value crossing the boundary, so the
        // specks are set aside rather than counted. What they cost is already in
        // the closing value, which puts it in `gain`, where a fee belongs.
        const legs = stripTransactionCosts(all, price, dustFraction, costs);
        const ins = legs.filter(m => INFLOW.has(m.kind));
        const outs = legs.filter(m => OUTFLOW.has(m.kind));
        if (!ins.length || !outs.length) {
            // One-sided: the other half happened somewhere this portfolio cannot
            // see, which makes it a genuine deposit or withdrawal.
            external.push(...legs);
            continue;
        }
        const inValue = sumValue(ins, price);
        const outValue = sumValue(outs, price);
        if (inValue == null || outValue == null) {
            external.push(...legs);   // let the pricing pass report it
            continue;
        }
        const scale = Math.max(inValue, outValue);
        const gap = scale > 0 ? Math.abs(inValue - outValue) / scale : 0;
        const detail = {
            swapKey: key,
            date: legs[0]?.date,
            inValue,
            outValue,
            net: inValue - outValue,
            gap,
            legs: legs.length,
            // The legs themselves, for callers that must account for the money
            // rather than refuse: this view cannot drop a year over one day.
            movements: legs,
            // Naming the sides is what makes a refusal actionable: the usual
            // cause is one leg priced from the wrong asset, and the symbol is
            // how anyone would spot that.
            inTokens: [...new Set(ins.map(m => m.symbol || m.token))],
            outTokens: [...new Set(outs.map(m => m.symbol || m.token))],
        };
        if (gap > tolerance) {
            suspect.push(detail);
            continue;
        }
        internal.push(detail);
    }
    return { internal, external, suspect, costs };
}

/**
 * Separate the specks from the substance within one transaction. A leg worth
 * less than `dustFraction` of the biggest leg beside it is the gas, not a side
 * of a trade.
 */
function stripTransactionCosts(legs, price, dustFraction, costs) {
    if (legs.length < 2) return legs;
    const valued = legs.map(m => {
        const p = price(m.token, m.date);
        return { m, value: p == null || !Number.isFinite(p) ? null : Math.abs(m.units * p) };
    });
    // An unpriceable leg is not dust by default — it is unknown, and the pricing
    // pass has to see it.
    const scale = Math.max(...valued.map(v => v.value ?? 0));
    if (!(scale > 0)) return legs;
    const kept = [];
    for (const v of valued) {
        if (v.value != null && v.value < scale * dustFraction) {
            costs.push({ token: v.m.token, symbol: v.m.symbol, date: v.m.date, value: v.value });
            continue;
        }
        kept.push(v.m);
    }
    return kept.length ? kept : legs;
}

function sumValue(legs, price) {
    let total = 0;
    for (const m of legs) {
        const p = price(m.token, m.date);
        if (p == null || !Number.isFinite(p)) return null;
        total += m.units * p;
    }
    return total;
}

/**
 * Check the gain against the FIFO engine, which arrives at the same figure by a
 * completely different route:
 *
 *     gain  =  realized  +  change in unrealized  +  yield received
 *
 * The yield term is not optional. Yield arrives at market value, so it lifts the
 * portfolio without moving unrealized P/L at all; leaving it out would make
 * every staking account look like a discrepancy.
 *
 * **What this catches:** a flow priced wrongly, a flow missed entirely, and a
 * swap that failed to net — the mechanical errors, which are exactly the ones
 * that would otherwise pass unnoticed into a chart.
 *
 * **What it cannot catch:** income misclassified as yield or the reverse. Both
 * arrive as new lots at market value, so the FIFO engine cannot tell them apart
 * either, and the yield term above moves in step with the misclassification —
 * the check is circular for this one case and reports agreement. That
 * distinction rests on the counterparty configuration being right, and no
 * arithmetic here can substitute for it. See flow-decomposition.spec.js, which
 * pins the limitation so it is not mistaken for coverage.
 */
function reconcile({ gain, earned, closing, fifo, reconcileTolerance }) {
    if (!fifo) return { available: false };
    const { realized = 0, unrealizedNow = 0, unrealizedOpening = 0 } = fifo;
    const expected = realized + (unrealizedNow - unrealizedOpening) + earned;
    const difference = gain - expected;
    const allowed = Math.max(Math.abs(closing), 1) * reconcileTolerance;
    return {
        available: true,
        expected,
        gain,
        difference,
        tolerance: allowed,
        agrees: Math.abs(difference) <= allowed,
    };
}
