import { separatePortfolioTransfers, bucketOf, baseAsset, CUSTODY_VENUES, GATEWAY_VENUES } from './portfolio-transfers.js';

const move = (over) => ({ date: '2026-08-19', kind: 'deposit', units: 1, counterparties: [], ...over });

describe('which bucket a token lives in', () => {
    it('tells the three apart', () => {
        expect(bucketOf('')).to.equal('native');
        expect(bucketOf('npro.nearmobile.near')).to.equal('native');
        expect(bucketOf('nep141:npro.nearmobile.near')).to.equal('intents');
        expect(bucketOf('confidential:nep141:npro.nearmobile.near')).to.equal('confidential');
    });

    it('sees one asset under all three', () => {
        expect(baseAsset('npro.nearmobile.near')).to.equal('npro.nearmobile.near');
        expect(baseAsset('nep141:npro.nearmobile.near')).to.equal('npro.nearmobile.near');
        expect(baseAsset('confidential:nep141:npro.nearmobile.near')).to.equal('npro.nearmobile.near');
        expect(baseAsset('')).to.equal('near');
    });
});

describe('carrying an asset between your own buckets', () => {
    // The real case: SOL 0.26225103 left intents under one transaction hash and
    // arrived in confidential under a synthesised one. Counted as a flow it read
    // as 189,62 added and 189,62 taken out on a day nothing crossed the edge.
    it('recognises the same units leaving one bucket and arriving in another', () => {
        const out = move({ token: 'nep141:sol.omft.near', symbol: 'SOL', kind: 'withdrawal', units: 0.26225103 });
        const into = move({ token: 'confidential:nep141:sol.omft.near', symbol: 'SOL', units: 0.26225103 });
        const { internal, external } = separatePortfolioTransfers([out, into]);
        expect(external).to.have.lengthOf(0);
        expect(internal).to.have.lengthOf(1);
        expect(internal[0].reason).to.equal('bucket-transfer');
        expect(internal[0].from).to.equal('intents');
        expect(internal[0].to).to.equal('confidential');
    });

    // Values drift between two sides at end-of-day prices; unit counts do not.
    // Matching on value is a coincidence waiting to be wrong.
    it('will not pair two different amounts of the same asset', () => {
        const out = move({ token: 'nep141:sol.omft.near', kind: 'withdrawal', units: 0.26225103 });
        const into = move({ token: 'confidential:nep141:sol.omft.near', units: 0.3 });
        expect(separatePortfolioTransfers([out, into]).external).to.have.lengthOf(2);
    });

    it('will not pair two different assets', () => {
        const out = move({ token: 'nep141:npro.nearmobile.near', kind: 'withdrawal', units: 5 });
        const into = move({ token: 'confidential:nep141:sol.omft.near', units: 5 });
        expect(separatePortfolioTransfers([out, into]).external).to.have.lengthOf(2);
    });

    it('will not pair two movements in the same bucket', () => {
        const out = move({ token: 'nep141:sol.omft.near', kind: 'withdrawal', units: 5 });
        const into = move({ token: 'nep141:sol.omft.near', units: 5 });
        expect(separatePortfolioTransfers([out, into]).external).to.have.lengthOf(2);
    });

    it('will not pair across days', () => {
        const out = move({ token: 'nep141:sol.omft.near', kind: 'withdrawal', units: 5 });
        const into = move({ token: 'confidential:nep141:sol.omft.near', units: 5, date: '2026-08-20' });
        expect(separatePortfolioTransfers([out, into]).external).to.have.lengthOf(2);
    });

    // Two legs, not three: a third movement of the same size is a separate event.
    it('pairs each leg only once', () => {
        const out = move({ token: 'nep141:sol.omft.near', kind: 'withdrawal', units: 5 });
        const inA = move({ token: 'confidential:nep141:sol.omft.near', units: 5 });
        const inB = move({ token: 'confidential:nep141:sol.omft.near', units: 5 });
        const { internal, external } = separatePortfolioTransfers([out, inA, inB]);
        expect(internal).to.have.lengthOf(1);
        expect(external).to.have.lengthOf(1);
    });
});

describe('who was on the other side', () => {
    // Every confidential movement in a real store names intents.near: the
    // confidential bucket only ever exchanges with the intents one. That needs
    // just the one leg, which is what makes it work when the other side sits in
    // a bucket this report does not cover.
    it('counts value arriving from your own venue as internal', () => {
        const m = move({ token: 'confidential:nep141:eth-0xa0b8.omft.near', symbol: 'USDC', kind: 'deposit', units: 121.35, counterparties: ['intents.near'] });
        const { internal, external } = separatePortfolioTransfers([m]);
        expect(external).to.have.lengthOf(0);
        expect(internal[0].reason).to.equal('own-venue');
    });

    // Withdrawing USDC from intents to an exchange and moving USDC from intents
    // into the confidential bucket are the same shape with the same
    // counterparty. Only the first left. Judged by counterparty alone, three
    // real withdrawals to an exchange disappeared from a real store, each one
    // confirmed by the receiving address on chain.
    it('will not call an outgoing leg internal on the counterparty alone', () => {
        const m = move({ token: 'nep141:eth-0xa0b8.omft.near', symbol: 'USDC', kind: 'withdrawal', units: 1622.05, counterparties: ['intents.near'] });
        expect(separatePortfolioTransfers([m]).external).to.have.lengthOf(1);
    });

    // Corroborated, it is internal again: the value is seen arriving.
    it('accepts an outgoing leg once the value is seen arriving elsewhere', () => {
        const out = move({ token: 'nep141:eth-0xa0b8.omft.near', symbol: 'USDC', kind: 'withdrawal', units: 1622.05, counterparties: ['intents.near'] });
        const into = move({ token: 'confidential:nep141:eth-0xa0b8.omft.near', symbol: 'USDC', kind: 'deposit', units: 1622.05, counterparties: ['intents.near'] });
        const { internal, external } = separatePortfolioTransfers([out, into]);
        expect(external).to.have.lengthOf(0);
        expect(internal[0].reason).to.equal('bucket-transfer');
    });

    it('leaves a transfer to someone else alone', () => {
        const m = move({ token: '', kind: 'withdrawal', units: 10, counterparties: ['someone-else.near'] });
        expect(separatePortfolioTransfers([m]).external).to.have.lengthOf(1);
    });

    // A batched transaction touching both is not a move to your own venue.
    it('needs every counterparty to be one of yours', () => {
        const m = move({ kind: 'withdrawal', units: 10, counterparties: ['intents.near', 'someone-else.near'] });
        expect(separatePortfolioTransfers([m]).external).to.have.lengthOf(1);
    });

    it('says nothing about a movement with no counterparty recorded', () => {
        const m = move({ kind: 'withdrawal', units: 10, counterparties: [] });
        expect(separatePortfolioTransfers([m]).external).to.have.lengthOf(1);
    });

    // Income and yield carry no counterparty list and must not be swallowed.
    it('leaves income and yield where they are', () => {
        const income = move({ kind: 'income', units: 27.8, symbol: 'NPRO' });
        const spend = move({ kind: 'expense', units: 1 });
        expect(separatePortfolioTransfers([income, spend]).external).to.have.lengthOf(2);
    });
});

describe('the order the two rules run in', () => {
    // The pairing has to go first. Its two legs are the same movement seen
    // twice; if the counterparty rule took one of them away, the other would be
    // left looking like a flow with nothing to pair against.
    it('pairs legs before judging them by counterparty', () => {
        const out = move({ token: 'nep141:sol.omft.near', symbol: 'SOL', kind: 'withdrawal', units: 0.26225103, counterparties: ['51e8f94d'] });
        const into = move({ token: 'confidential:nep141:sol.omft.near', symbol: 'SOL', units: 0.26225103, counterparties: ['intents.near'] });
        const { internal, external } = separatePortfolioTransfers([out, into]);
        expect(external).to.have.lengthOf(0);
        expect(internal).to.have.lengthOf(1);
        expect(internal[0].reason).to.equal('bucket-transfer');
    });
});

// Against a real store these two carried a large share of "taken out" and some
// of "added in" that never went anywhere: NEAR wrapped into wNEAR, and NEAR
// staked with a liquid staking pool and unstaked again.
describe('contracts that hold your value in another form', () => {
    const out = (over) => ({ date: '2026-02-10', kind: 'withdrawal', units: 6000.001, token: '', symbol: 'NEAR', counterparties: [], ...over });

    // Unwrapping and unstaking bring value back from a contract that was
    // holding it, so the arrival is internal whatever else is going on.
    it('does not call unwrapping NEAR a deposit', () => {
        const { internal, external } = separatePortfolioTransfers([out({ kind: 'deposit', counterparties: ['wrap.near'] })]);
        expect(external).to.have.lengthOf(0);
        expect(internal[0].reason).to.equal('own-venue');
    });

    it('does not call unstaking a deposit', () => {
        expect(separatePortfolioTransfers([out({ kind: 'deposit', counterparties: ['meta-pool.near'] })]).external).to.have.lengthOf(0);
    });

    // Nothing reaches the outside world through the wNEAR contract, so unlike a
    // gateway this one carries no doubt in either direction.
    it('does not call wrapping NEAR a withdrawal', () => {
        const { internal, external } = separatePortfolioTransfers([out({ counterparties: ['wrap.near'] })]);
        expect(external).to.have.lengthOf(0);
        expect(internal[0].reason).to.equal('own-venue');
    });

    it('does not call staking a withdrawal either', () => {
        expect(separatePortfolioTransfers([out({ counterparties: ['meta-pool.near'] })]).external).to.have.lengthOf(0);
    });

    // wNEAR is NEAR under another name, so the two legs of a wrap pair up even
    // when only one of them names the contract.
    it('sees wNEAR and NEAR as one asset', () => {
        expect(baseAsset('wrap.near')).to.equal('near');
        expect(baseAsset('nep141:wrap.near')).to.equal('near');
        expect(baseAsset('confidential:nep141:wrap.near')).to.equal('near');
    });

    it('pairs NEAR leaving with wNEAR arriving in another bucket', () => {
        const leaving = out({ units: 1272.4411 });
        const arriving = { date: '2026-02-10', kind: 'deposit', units: 1272.4411, token: 'nep141:wrap.near', symbol: 'wNEAR', counterparties: [] };
        const { internal, external } = separatePortfolioTransfers([leaving, arriving]);
        expect(external).to.have.lengthOf(0);
        expect(internal[0].reason).to.equal('bucket-transfer');
    });

    // An exchange you sold on is not a venue: the position is not yours after.
    it('still counts a transfer to somewhere else', () => {
        expect(separatePortfolioTransfers([out({ counterparties: ['some-exchange.near'] })]).external).to.have.lengthOf(1);
    });
});

// NEAR Intents books the asset going out and the asset coming in as two
// transactions, so the hash cannot tie them together. They land seconds apart
// because one intent execution produced both: nine and a half seconds and
// sixteen blocks, in the case this was written for.
describe('a trade settled as two transactions', () => {
    const T0 = 1787142611537000000n;
    // Nanoseconds, built from milliseconds so a fractional second survives.
    const at = (seconds) => String(T0 + BigInt(Math.round(seconds * 1000)) * 1_000_000n);
    const price = (token) => ({
        'nep141:npro.nearmobile.near': 1.9192,
        'nep141:sol.omft.near': 723.031,
        'confidential:nep141:sol.omft.near': 723.031,
    }[token] ?? null);

    // Implicit accounts are 64 hex characters, and the rule reads all of them,
    // so the fixtures carry a full id rather than the readable prefix.
    const implicit = (prefix) => prefix.padEnd(64, 'a');

    // Implicit accounts on both sides: a named solver is settled by the
    // market-maker rule before this one, so it would not exercise the pairing.
    const gave = { date: '2026-08-19', kind: 'withdrawal', units: 96.877202, token: 'nep141:npro.nearmobile.near', symbol: 'NPRO', counterparties: [implicit('540927c5')], at: at(0) };
    const got = { date: '2026-08-19', kind: 'deposit', units: 0.26225103, token: 'nep141:sol.omft.near', symbol: 'SOL', counterparties: [implicit('51e8f94d')], at: at(9.5) };

    it('pairs two legs that landed seconds apart', () => {
        const { internal, external } = separatePortfolioTransfers([gave, got], { price });
        expect(external).to.have.lengthOf(0);
        expect(internal[0].reason).to.equal('venue-trade');
        expect(internal[0].secondsApart).to.be.closeTo(9.5, 0.01);
    });

    // The same SOL moved on to the confidential bucket thirteen minutes later.
    // That is a different event and must not be swallowed into the trade.
    it('leaves legs that landed far apart alone', () => {
        const later = { ...got, at: at(3600) };
        expect(separatePortfolioTransfers([gave, later], { price }).external).to.have.lengthOf(2);
    });

    // Paying with native NEAR means wrapping it first, so the payment leaves one
    // bucket and the purchase arrives in another, minutes later. A real trade
    // put 254 seconds between them.
    it('pairs a payment in one bucket with a purchase in another', () => {
        const wrapped = { date: '2026-02-10', kind: 'withdrawal', units: 6000.000974, token: '', symbol: 'NEAR', counterparties: ['wrap.near'], at: at(0) };
        const bought = { date: '2026-02-10', kind: 'deposit', units: 5913.439411, token: 'nep141:usdc.near', symbol: 'USDC', counterparties: [implicit('6247d9c6')], at: at(254) };
        const withPrice = (token) => ({ '': 9.43, 'nep141:usdc.near': 9.51 }[token] ?? null);
        const { internal, external } = separatePortfolioTransfers([wrapped, bought], { price: withPrice });
        expect(external).to.have.lengthOf(0);
        expect(internal[0].reason).to.equal('venue-trade');
    });

    // The purchased USDC left for an exchange nine minutes later, identical to
    // the last decimal. Cancelling that pair would erase a real withdrawal —
    // it is the same asset, so it is never considered.
    it('never cancels a purchase against a withdrawal of the same asset', () => {
        const bought = { date: '2026-02-10', kind: 'deposit', units: 5913.439411, token: 'nep141:usdc.near', symbol: 'USDC', counterparties: [implicit('6247d9c6')], at: at(0) };
        const sentOut = { date: '2026-02-10', kind: 'withdrawal', units: 5913.439411, token: 'nep141:usdc.near', symbol: 'USDC', counterparties: [implicit('c172b566')], at: at(544) };
        const withPrice = () => 9.51;
        const { internal, external } = separatePortfolioTransfers([bought, sentOut], { price: withPrice });
        expect(internal.filter(i => i.reason === 'venue-trade')).to.have.lengthOf(0);
        expect(external).to.have.lengthOf(2);
    });

    // Value gets a veto, not a vote: an mt_transfer to someone else's intents
    // account is a real transfer out, and the owner of this code makes them.
    it('will not pair two legs of wildly different size', () => {
        const tiny = { ...got, units: 0.001 };
        expect(separatePortfolioTransfers([gave, tiny], { price }).external).to.have.lengthOf(2);
    });

    it('leaves a lone transfer out where it is', () => {
        expect(separatePortfolioTransfers([gave], { price }).external).to.have.lengthOf(1);
    });

    it('will not pair the same asset with itself — that is a transfer, not a trade', () => {
        const sameAsset = { ...got, token: 'nep141:npro.nearmobile.near', symbol: 'NPRO', units: 96.877202, kind: 'deposit' };
        const { internal } = separatePortfolioTransfers([gave, sameAsset], { price });
        expect(internal.every(i => i.reason !== 'venue-trade')).to.equal(true);
    });

    // Time and value alone are weak evidence. Withdrawing to an exchange and
    // being paid by somebody else four minutes later fits every other test the
    // rule applies — and cancelling the two would remove a real withdrawal and a
    // real deposit from the figures at once, silently, in the same stroke.
    it('will not pair two flows that neither side settled inside a venue', () => {
        const toExchange = { date: '2026-08-19', kind: 'withdrawal', units: 96.877202, token: 'nep141:npro.nearmobile.near', symbol: 'NPRO', counterparties: ['some-exchange.near'], at: at(0) };
        const fromAFriend = { date: '2026-08-19', kind: 'deposit', units: 0.26225103, token: 'nep141:sol.omft.near', symbol: 'SOL', counterparties: ['a-friend.near'], at: at(240) };
        const { internal, external } = separatePortfolioTransfers([toExchange, fromAFriend], { price });
        expect(internal.filter(i => i.reason === 'venue-trade')).to.have.lengthOf(0);
        expect(external).to.have.lengthOf(2);
    });

    // One side inside a venue is not enough either. A named venue leg never
    // reaches this rule — the counterparty rules above claim it first — so what
    // arrives here is an implicit address, and an implicit address on its own
    // proves nothing: a 1Click deposit address and a bridge payout look alike.
    it('will not pair a venue leg with a leg that went somewhere else', () => {
        const toExchange = { ...gave, counterparties: ['some-exchange.near'] };
        const { internal, external } = separatePortfolioTransfers([toExchange, got], { price });
        expect(internal.filter(i => i.reason === 'venue-trade')).to.have.lengthOf(0);
        expect(external).to.have.lengthOf(2);
    });

    // Nothing recorded on the other side says nothing about where it went.
    it('will not pair a leg with no counterparty at all', () => {
        const anonymous = { ...gave, counterparties: [] };
        expect(separatePortfolioTransfers([anonymous, got], { price }).external).to.have.lengthOf(2);
    });

    it('does nothing without prices, rather than pairing on time alone', () => {
        expect(separatePortfolioTransfers([gave, got]).external).to.have.lengthOf(2);
    });

    it('takes the closest leg in time when several could match', () => {
        const near = { ...got, at: at(5) };
        const far = { ...got, at: at(100) };
        const { internal, external } = separatePortfolioTransfers([gave, far, near], { price });
        expect(internal[0].secondsApart).to.be.closeTo(5, 0.01);
        expect(external).to.have.lengthOf(1);
    });
});

// The distinction that lets a wrap go both ways while a bridge does not.
describe('custody against gateway', () => {
    it('keeps the bridge out of the custody set', () => {
        expect(CUSTODY_VENUES.has('wrap.near')).to.equal(true);
        expect(CUSTODY_VENUES.has('meta-pool.near')).to.equal(true);
        expect(CUSTODY_VENUES.has('intents.near')).to.equal(false);
        expect(GATEWAY_VENUES.has('intents.near')).to.equal(true);
    });

    // A transaction touching both is not a pure custody move.
    it('needs every counterparty to be custody before letting a leg out', () => {
        const m = { date: '2026-02-10', kind: 'withdrawal', units: 10, token: '', symbol: 'NEAR',
            counterparties: ['wrap.near', 'intents.near'] };
        expect(separatePortfolioTransfers([m]).external).to.have.lengthOf(1);
    });
});

// The trade rule catches a swap whose legs land seconds apart. It cannot catch
// one whose payment was already, correctly, called internal — NEAR wrapped on
// its way into intents — leaving only the purchase, looking like a gift. On a
// real store that was a quarter of "added in", with no counterpart within a
// day.
describe('trading with a market maker', () => {
    const leg = (over) => ({ date: '2026-03-17', kind: 'deposit', units: 1888.4, token: 'nep141:usdc.near', symbol: 'USDC', counterparties: ['solver-multichain-asset.near'], ...over });

    it('is not money arriving from outside', () => {
        const { internal, external } = separatePortfolioTransfers([leg()]);
        expect(external).to.have.lengthOf(0);
        expect(internal[0].reason).to.equal('market-maker');
    });

    it('is not money leaving either — a solver is not an exchange', () => {
        expect(separatePortfolioTransfers([leg({ kind: 'withdrawal' })]).external).to.have.lengthOf(0);
    });

    it('knows the solvers by name', () => {
        for (const s of ['solver-priv-liq.near', 'solver-ref.near', 'crux-solver.near']) {
            expect(separatePortfolioTransfers([leg({ counterparties: [s] })]).external).to.have.lengthOf(0);
        }
    });

    // A person's intents account is a 64-character implicit address. A rule wide
    // enough to cover those would hide a genuine transfer from someone.
    it('leaves an implicit account counted', () => {
        const implicit = '540927c5958c199e9a9c40f51bfc1ecb3e228429c17c17faef74a921b1eb3adb';
        expect(separatePortfolioTransfers([leg({ counterparties: [implicit] })]).external).to.have.lengthOf(1);
    });

    it('leaves a solver it has never heard of counted, rather than guessing', () => {
        expect(separatePortfolioTransfers([leg({ counterparties: ['some-new-solver.near'] })]).external).to.have.lengthOf(1);
    });

    it('needs every counterparty to be a market maker', () => {
        expect(separatePortfolioTransfers([leg({ counterparties: ['solver-ref.near', 'someone.near'] })]).external).to.have.lengthOf(1);
    });

    // Income and yield are classified before this and must not be swallowed.
    it('leaves income alone even from a solver', () => {
        expect(separatePortfolioTransfers([leg({ kind: 'income' })]).external).to.have.lengthOf(1);
    });
});
