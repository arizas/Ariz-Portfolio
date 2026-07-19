import './accounts-page.component.js';
import { ACCESS_TOKEN_SESSION_STORAGE_KEY, __setTestWallet } from '../arizgateway/arizgatewayaccess.js';
import { __resetForTests } from '../near/intentshistory.js';
import { mockIntentsBackend, signingWallet, historyItem } from '../near/intentshistory.mock.js';
import { getConfidentialIntentsHistory } from '../storage/domainobjectstore.js';

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

    describe('per-account confidential intents fetch', () => {
        let backend;

        const until = async (fn, what) => {
            for (let i = 0; i < 500; i++) {
                if (fn()) return;
                await new Promise((r) => setTimeout(r, 10));
            }
            throw new Error('timed out waiting for ' + what);
        };
        const dismissModal = async () => {
            await until(() => document.querySelector('common-modal'), 'a modal');
            const modalEl = document.querySelector('common-modal');
            const text = modalEl.shadowRoot.textContent;
            modalEl.shadowRoot.querySelector('button').click();
            await until(() => !document.querySelector('common-modal'), 'modal dismissal');
            return text;
        };

        beforeEach(() => {
            __resetForTests();
            localStorage.setItem(ACCESS_TOKEN_SESSION_STORAGE_KEY,
                JSON.stringify({ token: 'test-token', accountId: 'alice.near', issuedAt: Date.now() }));
            backend = mockIntentsBackend();
        });

        afterEach(() => {
            backend.restore();
            __setTestWallet(null);
            localStorage.removeItem(ACCESS_TOKEN_SESSION_STORAGE_KEY);
        });

        it('each account row has a fetch-confidential button', () => {
            configComponent.setAccounts(['alice.near']);
            expect(shadowRoot.querySelectorAll('.fetchConfidentialButton').length).to.equal(1);
        });

        it('refuses when the connected wallet is not the row account (nothing fetched or stored)', async () => {
            signingWallet('alice.near');
            configComponent.setAccounts(['bob.near']);

            shadowRoot.querySelector('.fetchConfidentialButton').click();
            const text = await dismissModal();
            expect(text).to.contain('Wrong wallet');
            expect(text).to.contain('alice.near');
            expect(backend.authenticateCalls).to.equal(0);
            expect(await getConfidentialIntentsHistory('bob.near')).to.deep.equal([]);
        });

        it('fetches and stores the history when the wallet matches the row account', async () => {
            const wallet = signingWallet('alice.near');
            configComponent.setAccounts(['alice.near']);
            backend.pages['recipientType=CONFIDENTIAL_INTENTS'] = [[historyItem({
                depositAddress: 'acctpage1', recipient: 'alice.near',
            })]];

            shadowRoot.querySelector('.fetchConfidentialButton').click();
            const text = await dismissModal();
            expect(text).to.contain('Confidential history fetched');
            expect(text).to.contain('1 confidential intents item(s)');
            expect(wallet.signatureCount).to.equal(1);

            const stored = await getConfidentialIntentsHistory('alice.near');
            expect(stored.length).to.equal(1);
            expect(stored[0].depositAddress).to.equal('acctpage1');
        });
    });
});
