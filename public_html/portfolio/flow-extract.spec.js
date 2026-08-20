import { movementsForToken, swapKeyForHash, receivedClassifier, DEFAULT_RECEIVED_TYPES } from "./flow-extract.js";

const YOCTO = 1e-24;
const day = extra => ({ deposit: 0, withdrawal: 0, received: 0n, receivedFrom: [], expense: 0n, flows: [], ...extra });

describe('swapKeyForHash', () => {
    it('leaves an on-chain hash alone', () => {
        expect(swapKeyForHash('BmzxeoS22AGGeiRXE21EKsq9SGQaLsgsjNa1TNxDe9pi'))
            .to.equal('BmzxeoS22AGGeiRXE21EKsq9SGQaLsgsjNa1TNxDe9pi');
    });

    // The two legs of a confidential swap carry synthesised hashes that differ
    // only by direction; the deposit address is what they share.
    it('collapses the two directions of a confidential movement to one key', () => {
        const addr = 'confidential:6a4d34cb369edc45577809e7d10094c82fd990c3803726c070f11beb5d8d4cae';
        expect(swapKeyForHash(`${addr}:out`)).to.equal(addr);
        expect(swapKeyForHash(`${addr}:in`)).to.equal(addr);
        expect(swapKeyForHash(`${addr}:in`)).to.equal(swapKeyForHash(`${addr}:out`));
    });

    it('survives odd input', () => {
        expect(swapKeyForHash(undefined)).to.equal(undefined);
        expect(swapKeyForHash('confidential:')).to.equal('confidential:');
    });
});

describe('movementsForToken', () => {
    const base = { token: '', symbol: 'NEAR', decimalConversionValue: YOCTO };

    it('emits one movement per transaction, not one per day', () => {
        const m = movementsForToken({
            ...base,
            dailyBalances: {
                '2026-03-01': day({ flows: [
                    { hash: 'a', changed: 2e24 },
                    { hash: 'b', changed: -1e24 },
                ] }),
            },
        });
        expect(m).to.have.lengthOf(2);
        // Units come out of the year report's Number * decimalConversionValue,
        // so they carry the usual float dust; compare accordingly.
        expect(m[0]).to.include({ kind: 'deposit', swapKey: 'a' });
        expect(m[0].units).to.be.closeTo(2, 1e-9);
        expect(m[1]).to.include({ kind: 'withdrawal', swapKey: 'b' });
        expect(m[1].units).to.be.closeTo(1, 1e-9);
    });

    it('keeps the hash so the two legs of a swap can be paired later', () => {
        const near = movementsForToken({
            ...base,
            dailyBalances: { '2026-07-21': day({ flows: [{ hash: 'tx1', changed: -178.7e24 }] }) },
        });
        const btc = movementsForToken({
            token: 'nbtc.bridge.near', symbol: 'BTC', decimalConversionValue: 1e-8,
            dailyBalances: { '2026-07-21': day({ flows: [{ hash: 'tx1', changed: 551473 }] }) },
        });
        expect(near[0].swapKey).to.equal(btc[0].swapKey);
        expect(near[0].kind).to.equal('withdrawal');
        expect(btc[0].kind).to.equal('deposit');
    });

    it('defaults a received payment to income', () => {
        const m = movementsForToken({
            ...base,
            dailyBalances: { '2026-03-01': day({ receivedFrom: [{ account: 'someone.near', amount: 5e24 }] }) },
        });
        expect(m[0].kind).to.equal('income');
        expect(m[0].units).to.be.closeTo(5, 1e-9);
    });

    it('classifies a known yield payer as yield', () => {
        const m = movementsForToken({
            ...base,
            classifyReceived: receivedClassifier(DEFAULT_RECEIVED_TYPES),
            dailyBalances: {
                '2026-03-01': day({ receivedFrom: [
                    { account: 'distribution.nearmobile.near', amount: 3e24 },
                    { account: 'someone.near', amount: 7e24 },
                ] }),
            },
        });
        const near3 = m.find(x => Math.abs(x.units - 3) < 1e-9);
        const near7 = m.find(x => Math.abs(x.units - 7) < 1e-9);
        expect(near3.kind).to.equal('yield');
        expect(near7.kind).to.equal('income');
    });

    it('treats spend as an outflow without needing a counterparty', () => {
        const m = movementsForToken({
            ...base,
            dailyBalances: { '2026-03-01': day({ expense: 4e24 }) },
        });
        expect(m[0].kind).to.equal('expense');
        expect(m[0].units).to.be.closeTo(4, 1e-9);
    });

    it('honours a date window', () => {
        const balances = {
            '2026-01-01': day({ flows: [{ hash: 'a', changed: 1e24 }] }),
            '2026-06-01': day({ flows: [{ hash: 'b', changed: 1e24 }] }),
            '2026-12-01': day({ flows: [{ hash: 'c', changed: 1e24 }] }),
        };
        const m = movementsForToken({ ...base, dailyBalances: balances, from: '2026-02-01', to: '2026-07-01' });
        expect(m.map(x => x.swapKey)).to.deep.equal(['b']);
    });

    it('skips zero movements and days with nothing on them', () => {
        const m = movementsForToken({
            ...base,
            dailyBalances: {
                '2026-03-01': day({ flows: [{ hash: 'a', changed: 0 }] }),
                '2026-03-02': day(),
                '2026-03-03': undefined,
            },
        });
        expect(m).to.deep.equal([]);
    });

    it('tolerates daily entries from before flows were recorded', () => {
        const m = movementsForToken({
            ...base,
            dailyBalances: { '2026-03-01': { deposit: 5, withdrawal: 0 } },
        });
        expect(m).to.deep.equal([]);
    });
});

describe('receivedClassifier', () => {
    it('is income unless the entry says yield', () => {
        const c = receivedClassifier({
            'a.near': { description: 'salary' },
            'b.near': { description: 'rewards', type: 'yield' },
            'c.near': { type: 'income' },
        });
        expect(c('a.near')).to.equal('income');
        expect(c('b.near')).to.equal('yield');
        expect(c('c.near')).to.equal('income');
        expect(c('unknown.near')).to.equal('income');
    });
});
