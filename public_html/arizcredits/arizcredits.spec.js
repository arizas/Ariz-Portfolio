import {
    formatAriz, parseAriz, jsFunctionCall,
    buyTokensAction, authorizeAction, revokeAction, ftTransferAction, storageDepositAction,
    OPERATOR_ACCOUNT,
} from './arizcredits.js';

describe('arizcredits shared helpers', () => {
    it('formatAriz / parseAriz round-trip 6-decimal amounts', () => {
        expect(formatAriz('3000000')).to.equal('3');
        expect(formatAriz('1500000')).to.equal('1.5');
        expect(formatAriz('1')).to.equal('0.000001');
        expect(parseAriz('3')).to.equal('3000000');
        expect(parseAriz('1.5')).to.equal('1500000');
        expect(parseAriz('0.000001')).to.equal('1');
    });

    it('jsFunctionCall wraps an on-chain JS method in call_js_func', () => {
        const a = jsFunctionCall('foo', { x: 1 }, '7');
        expect(a.type).to.equal('FunctionCall');
        expect(a.params.methodName).to.equal('call_js_func');
        expect(a.params.args).to.deep.equal({ function_name: 'foo', x: 1 });
        expect(a.params.deposit).to.equal('7');
    });

    it('buyTokensAction attaches 0.5 NEAR', () => {
        expect(buyTokensAction().params.args.function_name).to.equal('buy_tokens_for_near');
        expect(buyTokensAction().params.deposit).to.equal('500000000000000000000000');
    });

    it('authorizeAction / revokeAction target the contract operator', () => {
        const auth = authorizeAction('2500000');
        expect(auth.params.args).to.deep.equal({
            function_name: 'authorize_deduction', operator_account: OPERATOR_ACCOUNT, max_amount_per_day: '2500000',
        });
        expect(revokeAction().params.args).to.deep.equal({
            function_name: 'revoke_deduction', operator_account: OPERATOR_ACCOUNT,
        });
    });

    it('ftTransferAction uses NEP-141 ft_transfer with 1 yocto', () => {
        const t = ftTransferAction('bob.near', '1000000');
        expect(t.params.methodName).to.equal('ft_transfer');
        expect(t.params.args).to.deep.equal({ receiver_id: 'bob.near', amount: '1000000' });
        expect(t.params.deposit).to.equal('1');
    });

    it('storageDepositAction registers the target account', () => {
        const s = storageDepositAction('bob.near');
        expect(s.params.methodName).to.equal('storage_deposit');
        expect(s.params.args).to.deep.equal({ account_id: 'bob.near', registration_only: true });
        expect(BigInt(s.params.deposit) > 0n).to.equal(true);
    });
});
