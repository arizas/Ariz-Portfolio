// Moving money between your own buckets is not a flow either.
//
// flow-decomposition.js recognises a swap by its transaction: two legs under one
// hash, removed whole. That leaves a second way to move value without any of it
// crossing the portfolio's edge — carrying an asset from one bucket to another.
// Native NEAR, the intents contract and a confidential address are three places
// the same portfolio keeps its money, and a move between them arrives as a
// withdrawal in one token's pass and a deposit in another's, under two
// different transactions. The hash cannot tie those together.
//
// On one real day that mattered: the row read 379 added and 1 516 taken out, on
// a day when almost nothing crossed the edge at all.
//
// Two signals, both structural. Neither compares values — a pair that merely
// adds up is a coincidence waiting to be wrong, and end-of-day prices make two
// sides of the same move differ anyway.

/** Accounts that hold this portfolio's own balances. */
export const PORTFOLIO_VENUES = new Set(['intents.near']);

const CONFIDENTIAL = 'confidential:';
const INTENTS = /^nep(141|245):/;

/** Which of the portfolio's buckets a token id belongs to. */
export function bucketOf(token) {
    if (typeof token !== 'string' || token === '') return 'native';
    if (token.startsWith(CONFIDENTIAL)) return 'confidential';
    return INTENTS.test(token) ? 'intents' : 'native';
}

/**
 * The asset underneath the bucket. `npro.nearmobile.near`,
 * `nep141:npro.nearmobile.near` and `confidential:nep141:npro.nearmobile.near`
 * are one asset in three places.
 */
export function baseAsset(token) {
    if (typeof token !== 'string' || token === '') return 'near';
    let id = token.startsWith(CONFIDENTIAL) ? token.slice(CONFIDENTIAL.length) : token;
    id = id.replace(INTENTS, '');
    return id;
}

/**
 * Split movements that already survived swap recognition into the ones that
 * only moved between the portfolio's own buckets and the ones that left it.
 *
 * @param {object[]} movements  external legs from separateSwaps
 * @param {object} [options]
 * @param {Set<string>} [options.venues]  accounts holding this portfolio's money
 * @param {number} [options.unitTolerance]  relative slack when matching units
 * @returns {{internal: object[], external: object[]}} `internal` is one entry
 *   per recognised transfer, carrying the legs it was decided from
 */
export function separatePortfolioTransfers(movements = [], {
    venues = PORTFOLIO_VENUES, unitTolerance = 1e-6,
} = {}) {
    const internal = [];
    const taken = new Set();

    // 1. The same asset, the same number of units, leaving one bucket and
    //    arriving in another on the same day. Units match to the last digit when
    //    it is one movement seen twice, which is what makes this a recognition
    //    rather than an arithmetic coincidence.
    const movable = movements.filter(m => m.kind === 'deposit' || m.kind === 'withdrawal');
    for (let i = 0; i < movable.length; i++) {
        const a = movable[i];
        if (taken.has(a)) continue;
        for (let j = i + 1; j < movable.length; j++) {
            const b = movable[j];
            if (taken.has(b)) continue;
            if (a.kind === b.kind) continue;
            if (a.date !== b.date) continue;
            if (baseAsset(a.token) !== baseAsset(b.token)) continue;
            if (bucketOf(a.token) === bucketOf(b.token)) continue;
            const scale = Math.max(Math.abs(a.units), Math.abs(b.units));
            if (!(scale > 0) || Math.abs(a.units - b.units) > scale * unitTolerance) continue;

            taken.add(a); taken.add(b);
            const from = a.kind === 'withdrawal' ? a : b;
            const to = a.kind === 'withdrawal' ? b : a;
            internal.push({
                reason: 'bucket-transfer',
                date: a.date,
                asset: baseAsset(a.token),
                symbol: a.symbol ?? b.symbol,
                units: a.units,
                from: bucketOf(from.token),
                to: bucketOf(to.token),
                movements: [from, to],
            });
            break;
        }
    }

    // 2. Whatever is left, judged by who was on the other side. A transfer to or
    //    from an account that holds this portfolio's own balance did not leave
    //    it — and unlike the pairing above, this needs only one of the two legs,
    //    which is what makes it work when the other side is in a bucket this
    //    report does not cover.
    const external = [];
    for (const m of movements) {
        if (taken.has(m)) continue;
        const parties = m.counterparties ?? [];
        if (parties.length && parties.every(p => venues.has(p))) {
            internal.push({
                reason: 'own-venue',
                date: m.date,
                asset: baseAsset(m.token),
                symbol: m.symbol,
                units: m.units,
                from: m.kind === 'withdrawal' ? bucketOf(m.token) : parties.join(', '),
                to: m.kind === 'withdrawal' ? parties.join(', ') : bucketOf(m.token),
                movements: [m],
            });
            continue;
        }
        external.push(m);
    }

    return { internal, external };
}
