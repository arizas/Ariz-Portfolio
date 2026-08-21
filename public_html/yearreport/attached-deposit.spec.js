import { formatAttachedDeposit, isBalanceMarker } from './yearreport-page.component.js';

// A yoctoNEAR amount is a 25-digit decimal string. Number cannot hold it
// exactly, so it is divided as digits rather than arithmetic.
describe('the attached deposit on a transaction', () => {
    it('reads yoctoNEAR as NEAR', () => {
        expect(formatAttachedDeposit('1000000000000000000000000')).to.equal('1');
        expect(formatAttachedDeposit('1500000000000000000000000')).to.equal('1.5');
        expect(formatAttachedDeposit('1')).to.equal('0.000000000000000000000001');
    });

    it('groups the whole part', () => {
        expect(formatAttachedDeposit('1234567000000000000000000000000')).to.equal('1 234 567');
    });

    // Beyond 2^53. Going through Number would round it.
    it('keeps every digit of a large amount', () => {
        expect(formatAttachedDeposit('123456789012345678901234567')).to.equal('123.456789012345678901234567');
    });

    it('says nothing when there was no deposit', () => {
        expect(formatAttachedDeposit(undefined)).to.equal('');
        expect(formatAttachedDeposit('')).to.equal('');
        expect(formatAttachedDeposit('not a number')).to.equal('');
    });

    it('reads zero as zero', () => {
        expect(formatAttachedDeposit('0')).to.equal('0');
    });
});

// The accounting export writes one of these per account per token per day.
// Combined across 44 tokens they outnumbered the real transactions on the day
// by ten to one, each with a link that goes nowhere.
describe('daily balance markers', () => {
    const marker = { hash: 'block-211075200', delta_amount: '0', visibleChangedBalance: 0 };

    it('recognises one', () => {
        expect(isBalanceMarker(marker)).to.equal(true);
    });

    it('leaves real transactions alone', () => {
        expect(isBalanceMarker({ hash: '2wNBHE5SELeQ7QerM2XMBFx83DPnAgzRXA2KtrA2iu6D', delta_amount: '20645295497469361678210788', visibleChangedBalance: 20.6 })).to.equal(false);
        expect(isBalanceMarker({ hash: 'AbC', visibleChangedBalance: -0.03 })).to.equal(false);
    });

    // A block-hash row that did move something is a real movement recorded
    // against a block rather than a transaction. Dropping it would lose money.
    it('keeps a block-hash row that moved something', () => {
        expect(isBalanceMarker({ ...marker, delta_amount: '5000' })).to.equal(false);
        expect(isBalanceMarker({ ...marker, visibleChangedBalance: -1.5 })).to.equal(false);
    });

    it('survives a missing transaction', () => {
        expect(isBalanceMarker(undefined)).to.equal(false);
        expect(isBalanceMarker({})).to.equal(false);
    });
});
