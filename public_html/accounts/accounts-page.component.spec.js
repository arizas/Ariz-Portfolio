import './accounts-page.component.js';
import { __setTestWallet } from '../arizgateway/arizgatewayaccess.js';

describe('accounts-page.component', () => {
    let configComponent;
    let shadowRoot;
    before(async () => {
        configComponent = document.createElement('accounts-page');
        document.documentElement.appendChild(configComponent);
        shadowRoot = await configComponent.readyPromise;    
    });
    after(() => {
        configComponent.remove();
    });
    it('should display the config component and add two account rows', () => {
        expect(shadowRoot.querySelectorAll('.accountname').length).to.equal(0);
        shadowRoot.querySelector('#addAccountButton').click();
        expect(shadowRoot.querySelectorAll('.accountname').length).to.equal(1);
        shadowRoot.querySelector('#addAccountButton').click();
        expect(shadowRoot.querySelectorAll('.accountname').length).to.equal(2);
    });
    it('should remove one accountrow', () => {
        expect(shadowRoot.querySelectorAll('.accountname').length).to.equal(2);
        shadowRoot.querySelectorAll('.removeAccountButton')[1].click();
        expect(shadowRoot.querySelectorAll('.accountname').length).to.equal(1);
        shadowRoot.querySelectorAll('.removeAccountButton')[0].click();
        expect(shadowRoot.querySelectorAll('.accountname').length).to.equal(0);
    });
    it('should set and get accounts', () => {
        const accountsArray = ['account1', 'ACCOUNT2'];
        configComponent.setAccounts(accountsArray);
        expect(configComponent.getAccounts()).to.deep.equal(accountsArray);
    });
    it('should listen for account changes', async () => {
        const changePromise = new Promise(resolve =>
            configComponent.addEventListener('change', (e) => {
                resolve(e);
            })
        );
        const accountNameInput = shadowRoot.querySelectorAll('.accountname')[1];
        accountNameInput.value = 'test.near';
        accountNameInput.dispatchEvent(new Event('change'));
        await changePromise;
        expect(configComponent.getAccounts()[1]).to.equal('test.near');
    });
});

function rpc(json) {
    return { json: async () => ({ result: { result: Array.from(new TextEncoder().encode(json)) } }) };
}

describe('accounts-page ARIZ actions', () => {
    let origFetch, sent, el;

    function setWallet(accountId) {
        __setTestWallet({
            accountId,
            async getAccounts() { return [{ accountId }]; },
            async signAndSendTransaction(p) { sent.push(p); return { status: 'ok' }; },
            async signMessage() { return { accountId, publicKey: 'ed25519:x', signature: '' }; },
            async signOut() {},
        });
    }

    beforeEach(async () => {
        sent = [];
        setWallet('funder.near');
        origFetch = globalThis.fetch;
        globalThis.fetch = async (_url, opts) => {
            const body = JSON.parse(opts.body);
            const m = body.params.method_name;
            const args = JSON.parse(atob(body.params.args_base64));
            if (m === 'storage_balance_of') {
                return rpc(args.account_id === 'registered.near' ? JSON.stringify({ total: '1', available: '0' }) : 'null');
            }
            if (m === 'ft_balance_of') return rpc('"0"');
            return rpc('null'); // view_js_func etc.
        };
        el = document.createElement('accounts-page');
        document.body.appendChild(el);
        await el.readyPromise;
    });

    afterEach(() => {
        globalThis.fetch = origFetch;
        __setTestWallet(null);
        el.remove();
    });

    it('fundRow registers + transfers ARIZ for an unregistered account', async () => {
        el.addAccountRow('new.near');
        const row = el.accountsTable.lastElementChild;
        row.querySelector('.fundamount').value = '2';
        await el.fundRow(row);

        expect(sent.length).to.equal(1);
        expect(sent[0].receiverId).to.equal('arizcredits.near');
        const actions = sent[0].actions;
        expect(actions[0].params.methodName).to.equal('storage_deposit');
        expect(actions[1].params.methodName).to.equal('ft_transfer');
        expect(actions[1].params.args).to.deep.equal({ receiver_id: 'new.near', amount: '2000000' });
    });

    it('fundRow skips storage_deposit for an already-registered account', async () => {
        el.addAccountRow('registered.near');
        const row = el.accountsTable.lastElementChild;
        row.querySelector('.fundamount').value = '1';
        await el.fundRow(row);

        const actions = sent[0].actions;
        expect(actions.length).to.equal(1);
        expect(actions[0].params.methodName).to.equal('ft_transfer');
        expect(actions[0].params.args.amount).to.equal('1000000');
    });

    it('authorizeRow signs authorize_deduction when connected as that account', async () => {
        setWallet('self.near');
        el.addAccountRow('self.near');
        const row = el.accountsTable.lastElementChild;
        row.querySelector('.fundamount').value = '1';
        await el.authorizeRow(row);

        expect(sent.length).to.equal(1);
        expect(sent[0].actions[0].params.args).to.deep.equal({
            function_name: 'authorize_deduction',
            operator_account: 'arizcredits.near',
            max_amount_per_day: '1000000',
        });
    });
});