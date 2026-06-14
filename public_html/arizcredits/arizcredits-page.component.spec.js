import { __setTestWallet } from '../arizgateway/arizgatewayaccess.js';
import { formatAriz, parseAriz, jsFunctionCall } from './arizcredits-page.component.js';
import './arizcredits-page.component.js';

describe('arizcredits helpers', () => {
    it('formatAriz renders raw 6-decimal amounts', () => {
        expect(formatAriz('3000000')).to.equal('3');
        expect(formatAriz('1500000')).to.equal('1.5');
        expect(formatAriz('0')).to.equal('0');
        expect(formatAriz('1')).to.equal('0.000001');
    });

    it('parseAriz converts human ARIZ to raw 6-decimal', () => {
        expect(parseAriz('3')).to.equal('3000000');
        expect(parseAriz('1.5')).to.equal('1500000');
        expect(parseAriz('0.000001')).to.equal('1');
    });

    it('jsFunctionCall builds a call_js_func dispatch action', () => {
        const a = jsFunctionCall('revoke_deduction', { operator_account: 'arizcredits.near' });
        expect(a.type).to.equal('FunctionCall');
        expect(a.params.methodName).to.equal('call_js_func');
        expect(a.params.args).to.deep.equal({ function_name: 'revoke_deduction', operator_account: 'arizcredits.near' });
        expect(a.params.deposit).to.equal('0');
    });
});

describe('arizcredits-page', () => {
    let origFetch, sent;

    function rpcReturn(jsonString) {
        return { json: async () => ({ result: { result: Array.from(new TextEncoder().encode(jsonString)) } }) };
    }

    beforeEach(() => {
        sent = [];
        __setTestWallet({
            accountId: 'alice.near',
            async getAccounts() { return [{ accountId: 'alice.near' }]; },
            async signAndSendTransaction(params) { sent.push(params); return { status: 'ok' }; },
            async signMessage() { return { accountId: 'alice.near', publicKey: 'ed25519:x', signature: '' }; },
            async signOut() {},
        });
        origFetch = globalThis.fetch;
        globalThis.fetch = async (_url, opts) => {
            const body = JSON.parse(opts.body);
            const method = body.params.method_name;
            const args = JSON.parse(atob(body.params.args_base64));
            if (method === 'ft_balance_of') return rpcReturn('"3000000"');
            if (method === 'view_js_func' && args.function_name === 'view_authorisation') {
                return rpcReturn(JSON.stringify({ max_per_day: '1000000', last_deduct_day: '', spent_today: '0' }));
            }
            if (method === 'view_js_func' && args.function_name === 'view_spent_since_reset') return rpcReturn('"0"');
            return rpcReturn('null');
        };
    });

    afterEach(() => {
        globalThis.fetch = origFetch;
        __setTestWallet(null);
    });

    it('renders balance + authorisation for the signed-in account', async () => {
        const el = document.createElement('arizcredits-page');
        document.body.appendChild(el);
        const root = await el.readyPromise;
        expect(root.getElementById('acct').textContent).to.equal('alice.near');
        expect(root.getElementById('balance').textContent).to.equal('3 ARIZ');
        expect(root.getElementById('authstatus').textContent).to.equal('up to 1 ARIZ/day');
        expect(root.getElementById('spent').textContent).to.equal('0 ARIZ');
        el.remove();
    });

    it('authorize sends call_js_func authorize_deduction with the raw cap', async () => {
        const el = document.createElement('arizcredits-page');
        document.body.appendChild(el);
        await el.readyPromise;
        el.shadowRoot.getElementById('maxperday').value = '2.5';
        await el._run(() => el.authorize());

        expect(sent.length).to.equal(1);
        expect(sent[0].receiverId).to.equal('arizcredits.near');
        expect(sent[0].actions[0].params.args).to.deep.equal({
            function_name: 'authorize_deduction',
            operator_account: 'arizcredits.near',
            max_amount_per_day: '2500000',
        });
        el.remove();
    });

    it('buy sends buy_tokens_for_near with 0.5 NEAR attached', async () => {
        const el = document.createElement('arizcredits-page');
        document.body.appendChild(el);
        await el.readyPromise;
        await el._run(() => el.buy());

        const action = sent[0].actions[0];
        expect(action.params.args.function_name).to.equal('buy_tokens_for_near');
        expect(action.params.deposit).to.equal('500000000000000000000000');
        el.remove();
    });

    it('shows the signed-out notice when no account', async () => {
        __setTestWallet({ async getAccounts() { return []; } });
        const el = document.createElement('arizcredits-page');
        document.body.appendChild(el);
        const root = await el.readyPromise;
        expect(root.getElementById('signedout').style.display).to.equal('');
        expect(root.getElementById('panel').style.display).to.equal('none');
        el.remove();
    });
});
