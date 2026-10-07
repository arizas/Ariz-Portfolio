// The other side of a swap.
//
// The year report runs one FIFO pass per token, and inside that pass a swap is
// only ever half visible: a withdrawal of the token being read, with no idea
// what came back for it. The other half sits in another token's records under
// the same transaction hash — or, for a confidential swap, under a synthetic
// hash that differs from its partner only by direction.
//
// This module reads every token's balance series once and answers one
// question: for a given swap key, which tokens moved, and by how much. It is
// deliberately unpriced. What a leg is worth depends on the report's currency
// and on which leg is trusted, and both of those are decided in the profit and
// loss step (see resolveSwapValue). Here there are only amounts.

import { deriveChangedBalances } from './yearreportdata.js';
import { swapKeyForHash } from '../portfolio/flow-extract.js';

export const NATIVE_NEAR = '';

/**
 * @typedef {object} SwapLeg
 * @property {string} token    contract id, '' for native NEAR
 * @property {string} symbol
 * @property {number} decimals
 * @property {bigint} changed  raw units, negative for the side that left
 * @property {number|null} usd  what the venue said the leg was worth, in USD,
 *   when every row behind it carried a mark; null otherwise
 */

/**
 * Every swap key that moved more than one token, with each token's net change
 * across all accounts.
 *
 * @param {object} args
 * @param {Record<string, object[]>} args.nativeByAccount   transactions.json per account, newest first
 * @param {Record<string, object[]>} args.fungibleByAccount  fungible_token_transactions.json per account (confidential rows included), newest first
 * @returns {Map<string, SwapLeg[]>} keyed by swap key; only keys with two or more tokens
 */
export function indexSwapLegs({ nativeByAccount = {}, fungibleByAccount = {} }) {
    // key -> token -> leg
    const byKey = new Map();
    const add = (hash, token, symbol, decimals, changed, usd = null) => {
        if (changed === 0n) return;
        const key = swapKeyForHash(hash);
        if (!byKey.has(key)) byKey.set(key, new Map());
        const legs = byKey.get(key);
        const leg = legs.get(token) ?? { token, symbol, decimals, changed: 0n, usd: 0, marked: 0, rows: 0 };
        leg.changed += changed;
        leg.rows += 1;
        if (usd != null && Number.isFinite(Number(usd))) {
            leg.usd += Number(usd);
            leg.marked += 1;
        }
        legs.set(token, leg);
    };

    for (const txs of Object.values(nativeByAccount)) {
        const series = txs.filter(tx => tx.balance !== undefined).map(tx => ({ ...tx }));
        deriveChangedBalances(series);
        for (const tx of series) add(tx.hash, NATIVE_NEAR, 'NEAR', 24, tx.changedBalance);
    }

    for (const txs of Object.values(fungibleByAccount)) {
        // The balance series is per token, so the changes have to be derived
        // per token: a USDC balance is not the next observation of a BTC one.
        const perToken = new Map();
        for (const tx of txs) {
            if (tx.balance === undefined || !tx.ft?.contract_id) continue;
            const id = tx.ft.contract_id;
            if (!perToken.has(id)) perToken.set(id, []);
            perToken.get(id).push({ ...tx, hash: tx.transaction_hash });
        }
        for (const [id, series] of perToken) {
            deriveChangedBalances(series);
            for (const tx of series) add(tx.hash, id, tx.ft.symbol, tx.ft.decimals, tx.changedBalance, tx.fiat_usd);
        }
    }

    const swaps = new Map();
    for (const [key, legs] of byKey) {
        if (legs.size < 2) continue;
        // A mark on some rows of a leg and not others is no mark at all.
        swaps.set(key, [...legs.values()].map(({ token, symbol, decimals, changed, usd, marked, rows }) =>
            ({ token, symbol, decimals, changed, usd: marked === rows ? usd : null })));
    }
    return swaps;
}

/**
 * USD-pegged, as far as pricing is concerned. Mirrors the short-circuit in
 * pricedata.getEODPrice so both agree on what a stablecoin is.
 */
export function isStablecoinSymbol(symbol) {
    if (typeof symbol !== 'string') return false;
    const s = symbol.toUpperCase();
    return s.startsWith('USD') || s === 'USN';
}

/**
 * The one value both legs of a swap share, in the report's currency.
 *
 * A swap's source realization and destination cost basis must be the same
 * number, or the difference leaks out of the books for good. Which number:
 *
 *   1. the venue's own fiat mark for the destination legs — what it said
 *      they were worth when the trade settled; the source legs' mark if the
 *      destination has none
 *   2. a stablecoin leg, its amount at that day's price — the nearest thing
 *      to a fiat receipt the chain itself offers; the destination side wins
 *      if both sides are stable
 *   3. the destination legs at their end-of-day price
 *   4. the source legs at theirs, only when nothing on the destination side
 *      has a price that day
 *
 * Gas is not a leg. Every transaction that moves a token also moves a speck of
 * NEAR, and a speck worth under `dustFraction` of the biggest leg beside it is
 * the cost of transacting, not a side of the trade.
 *
 * @param {SwapLeg[]} legs
 * @param {(leg: SwapLeg) => number|null} eodValue  value of the leg's full amount in the report currency, or null if unpriced
 * @param {object} [options]
 * @param {number} [options.dustFraction]
 * @param {(leg: SwapLeg) => number|null} [options.fiatValue]  the leg's venue mark in the report currency, or null
 * @returns {{ value: number, valuedBy: 'fiat'|'stablecoin'|'destination'|'source', authority: SwapLeg[], legs: SwapLeg[] }|null}
 *   null when no leg on either side can be priced, or when the key does not
 *   have both an in and an out side once dust is set aside
 */
export function resolveSwapValue(legs, eodValue, { dustFraction = 0.01, fiatValue = () => null } = {}) {
    const priced = legs.map(leg => ({ leg, value: eodValue(leg) }));
    const largest = Math.max(0, ...priced.map(p => Math.abs(p.value ?? 0)));
    const substance = priced.filter(p => p.value == null || Math.abs(p.value) >= largest * dustFraction);

    const ins = substance.filter(p => p.leg.changed > 0n);
    const outs = substance.filter(p => p.leg.changed < 0n);
    if (!ins.length || !outs.length) return null;

    const sumOf = side => side.every(p => p.value != null)
        ? side.reduce((sum, p) => sum + Math.abs(p.value), 0)
        : null;

    for (const side of [ins, outs]) {
        const marks = side.map(p => fiatValue(p.leg));
        if (marks.length && marks.every(m => m != null && m > 0)) {
            return {
                value: marks.reduce((sum, m) => sum + m, 0),
                valuedBy: 'fiat',
                authority: side.map(p => p.leg),
                legs: substance.map(p => p.leg),
            };
        }
    }

    for (const side of [ins, outs]) {
        const stable = side.filter(p => isStablecoinSymbol(p.leg.symbol) && p.value != null);
        if (stable.length) {
            return {
                value: stable.reduce((sum, p) => sum + Math.abs(p.value), 0),
                valuedBy: 'stablecoin',
                authority: stable.map(p => p.leg),
                legs: substance.map(p => p.leg),
            };
        }
    }

    const inValue = sumOf(ins);
    if (inValue != null && inValue > 0) {
        return { value: inValue, valuedBy: 'destination', authority: ins.map(p => p.leg), legs: substance.map(p => p.leg) };
    }
    const outValue = sumOf(outs);
    if (outValue != null && outValue > 0) {
        return { value: outValue, valuedBy: 'source', authority: outs.map(p => p.leg), legs: substance.map(p => p.leg) };
    }
    return null;
}
