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

/**
 * Contracts that can only ever give the value back to you. Sending NEAR to
 * wrap.near returns wNEAR one for one; sending it to a staking pool returns
 * stNEAR, and later NEAR again. There is no way to reach the outside world
 * through one of these, so a movement in either direction stayed inside.
 */
export const CUSTODY_VENUES = new Set([
    'wrap.near',
    'meta-pool.near',
]);

/**
 * Contracts that hold your balance *and* can send it out of the portfolio.
 * intents.near is both: moving USDC from intents into the confidential bucket
 * and withdrawing it to an exchange are the same shape with the same
 * counterparty, and only the second left. So value arriving from one of these
 * came from inside, and value going to one is not decidable from the
 * counterparty alone — it has to be corroborated.
 */
export const GATEWAY_VENUES = new Set([
    'intents.near',
]);

/** Every account that holds this portfolio's own balance. */
export const PORTFOLIO_VENUES = new Set([...CUSTODY_VENUES, ...GATEWAY_VENUES]);

/**
 * Market makers inside NEAR Intents. Value moving between you and one of these
 * is the two halves of a trade: you never receive a gift from a solver, and you
 * cannot reach an exchange through one either.
 *
 * The trade rule below already catches a swap whose two legs land seconds
 * apart. It cannot catch one whose payment was something this report has
 * already, correctly, called internal — NEAR wrapped into wNEAR on its way into
 * intents, for instance. Then only the purchase is left, looking like money
 * someone gave you. On one real store that was 103 889 of "added in" with no
 * counterpart anywhere within a day.
 *
 * Named accounts only, deliberately. Another person's intents account is a
 * 64-character implicit address, and a rule broad enough to cover those would
 * hide a genuine transfer from someone. A solver this list does not know stays
 * counted, which is the visible failure rather than the quiet one.
 */
export const TRADING_COUNTERPARTIES = new Set([
    'solver-multichain-asset.near',
    'solver-multichain-asset-escrow.near',
    'solver-priv-liq.near',
    'solver-priv-liq-2.near',
    'solver-ref.near',
    'crux-solver.near',
]);

/**
 * Tokens that are one asset wearing two names. wNEAR is NEAR — wrapping is a
 * change of form, not of ownership — so a movement of one pairs with a movement
 * of the other.
 */
const SAME_ASSET = new Map([
    ['wrap.near', 'near'],
]);

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
    return SAME_ASSET.get(id) ?? id;
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
    venues = PORTFOLIO_VENUES, custody = CUSTODY_VENUES,
    traders = TRADING_COUNTERPARTIES, unitTolerance = 1e-6,
    price = null, tradeWindowSeconds = 120, tradeTolerance = 0.25,
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

    // 2. A trade inside one venue, settled as two transactions. NEAR Intents
    //    books the asset going out and the asset coming in separately, so the
    //    hash cannot tie them together — but they land seconds apart, because
    //    one intent execution produced both. Nine and a half seconds, sixteen
    //    blocks, in the case this was written for.
    //
    //    Time is the signal, not value. Value alone would also match an
    //    mt_transfer to someone else's intents account that happened to be
    //    about the right size, and those are real transfers out; the owner of
    //    this code does make them. Value only gets a veto: two legs far apart in
    //    size are not one trade however close together they landed.
    if (price) {
        const inVenue = movable.filter(m => !taken.has(m) && bucketOf(m.token) !== 'native' && m.at != null);
        for (let i = 0; i < inVenue.length; i++) {
            const a = inVenue[i];
            if (taken.has(a)) continue;
            let best = null;
            for (let j = 0; j < inVenue.length; j++) {
                const b = inVenue[j];
                if (b === a || taken.has(b)) continue;
                if (a.kind === b.kind) continue;
                if (bucketOf(a.token) !== bucketOf(b.token)) continue;
                if (baseAsset(a.token) === baseAsset(b.token)) continue;
                const apart = secondsApart(a.at, b.at);
                if (apart == null || apart > tradeWindowSeconds) continue;
                const av = valueOf(a, price), bv = valueOf(b, price);
                if (av == null || bv == null) continue;
                const scale = Math.max(av, bv);
                if (!(scale > 0) || Math.abs(av - bv) / scale > tradeTolerance) continue;
                if (!best || apart < best.apart) best = { b, apart, av, bv };
            }
            if (!best) continue;
            taken.add(a); taken.add(best.b);
            const gave = a.kind === 'withdrawal' ? a : best.b;
            const got = a.kind === 'withdrawal' ? best.b : a;
            internal.push({
                reason: 'venue-trade',
                date: a.date,
                asset: baseAsset(gave.token),
                symbol: `${gave.symbol ?? gave.token} -> ${got.symbol ?? got.token}`,
                units: gave.units,
                from: bucketOf(gave.token),
                to: bucketOf(got.token),
                secondsApart: best.apart,
                movements: [gave, got],
            });
        }
    }

    // 3. Whatever is left, judged by who was on the other side — but only in one
    //    direction, and this is the important part.
    //
    //    Value arriving from an account that holds this portfolio's own balance
    //    came from inside it. An arrival cannot be money leaving, so calling it
    //    internal can overstate nothing.
    //
    //    Going the other way it depends which venue. Withdrawing USDC from
    //    intents to an exchange and moving USDC from intents into the
    //    confidential bucket are the same transaction shape with the same
    //    counterparty, and only the first left the portfolio; judging that on
    //    the counterparty alone hid three genuine withdrawals, 3 352 USDC, on a
    //    real store. Overstating what left is a number someone can argue with;
    //    hiding it is money that quietly stops existing. So a leg going out
    //    through a gateway has to be corroborated instead — the pairing above
    //    has to see the value arrive, or the trade rule has to recognise it.
    //
    //    A custody venue carries no such doubt. Nothing reaches the outside
    //    world through the wNEAR contract or a staking pool; they can only give
    //    the value back. Those go both ways.
    const external = [];
    for (const m of movements) {
        if (taken.has(m)) continue;
        const parties = m.counterparties ?? [];
        // Trading with a market maker moves value between assets, never across
        // the portfolio's edge — in either direction.
        if (parties.length && parties.every(p => traders.has(p))
            && (m.kind === 'deposit' || m.kind === 'withdrawal')) {
            internal.push({
                reason: 'market-maker',
                date: m.date, asset: baseAsset(m.token), symbol: m.symbol, units: m.units,
                from: m.kind === 'withdrawal' ? bucketOf(m.token) : parties.join(', '),
                to: m.kind === 'withdrawal' ? parties.join(', ') : bucketOf(m.token),
                movements: [m],
            });
            continue;
        }
        const allVenues = parties.length && parties.every(p => venues.has(p));
        const allCustody = parties.length && parties.every(p => custody.has(p));
        if (allVenues && (m.kind === 'deposit' || allCustody)) {
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

function valueOf(m, price) {
    const p = price(m.token, m.date);
    return p == null || !Number.isFinite(p) ? null : Math.abs(m.units * p);
}

/** Block timestamps are nanoseconds, as strings too long for a Number. */
function secondsApart(a, b) {
    try {
        const diff = BigInt(a) - BigInt(b);
        return Number((diff < 0n ? -diff : diff) / 1000000n) / 1000;
    } catch {
        return null;
    }
}
