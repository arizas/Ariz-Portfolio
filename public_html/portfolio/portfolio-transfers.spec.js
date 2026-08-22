import { separatePortfolioTransfers, bucketOf, baseAsset } from './portfolio-transfers.js';

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
    it('counts a move to the account holding your own balance as internal', () => {
        const m = move({ token: 'confidential:nep141:eth-0xa0b8.omft.near', symbol: 'USDC', kind: 'withdrawal', units: 121.35, counterparties: ['intents.near'] });
        const { internal, external } = separatePortfolioTransfers([m]);
        expect(external).to.have.lengthOf(0);
        expect(internal[0].reason).to.equal('own-venue');
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
