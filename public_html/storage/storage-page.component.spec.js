import { egitCloneCommand, prepareSyncRemote } from './storage-page.component.js';
import { arizgatewayhost, __setTestWallet } from '../arizgateway/arizgatewayaccess.js';
import { __setTestServiceWorkerContainer } from '../arizgateway/encryptedsync.js';
import { __clearDekForTests, obtainDek, currentDekHex } from '../arizgateway/encryptionkey.js';
import { fakeWallet, mockStore } from '../arizgateway/encryptionkey.mock.js';
import { fakeSwContainer } from '../arizgateway/encryptedsync.mock.js';
import { mockWalletAuthenticationData } from '../arizgateway/arizgatewayaccess.spec.js';

describe('storage-page component (encrypted-only sync)', () => {
    before(() => {
        mockWalletAuthenticationData('test.near');
    });

    it('builds an encrypted clone command with the key, auth and egit:: remote', () => {
        const cmd = egitCloneCommand('ab'.repeat(32), 'TOKEN123');
        expect(cmd).to.contain(`EGIT_KEY=${'ab'.repeat(32)}`);
        expect(cmd).to.contain('EGIT_AUTH="Bearer TOKEN123"');
        expect(cmd).to.contain(`git clone "egit::${arizgatewayhost}/store/me"`);
    });

    describe('prepareSyncRemote', () => {
        let store;
        let sw;

        beforeEach(() => {
            __clearDekForTests();
            localStorage.setItem('ariz_gateway_access_token',
                JSON.stringify({ token: 'test-token', accountId: 'test.near', issuedAt: Date.now() }));
            store = mockStore();
            sw = fakeSwContainer();
            __setTestServiceWorkerContainer(sw);
            fakeWallet('test.near');
        });

        afterEach(() => {
            store.restore();
            __setTestWallet(null);
            __setTestServiceWorkerContainer(null);
            localStorage.removeItem('ariz_gateway_access_token');
        });

        it('ALWAYS configures the service worker and returns /egit/<account> — plaintext is retired', async () => {
            const url = await prepareSyncRemote();
            expect(url).to.equal(`${location.origin}/egit/test.near`);
            expect(sw.registerCalls.length).to.equal(1);
            expect(sw.active.messages.length).to.equal(1);
            expect(sw.active.messages[0].type).to.equal('egit-set-key');
            expect(sw.active.messages[0].repoId).to.equal('test.near');
        });
    });

    describe('encrypted sync UI', () => {
        let store;
        let sw;
        let el;

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

        beforeEach(async () => {
            __clearDekForTests();
            localStorage.setItem('ariz_gateway_access_token',
                JSON.stringify({ token: 'test-token', accountId: 'test.near', issuedAt: Date.now() }));
            store = mockStore();
            sw = fakeSwContainer();
            __setTestServiceWorkerContainer(sw);
            fakeWallet('test.near');
            el = document.createElement('storage-page');
            document.body.appendChild(el);
            await el.readyPromise;
        });

        afterEach(() => {
            el.remove();
            store.restore();
            __setTestWallet(null);
            __setTestServiceWorkerContainer(null);
            localStorage.removeItem('ariz_gateway_access_token');
        });

        it('renders the encrypted-only UI: no plaintext CLI, no enable/disable toggle', async () => {
            const $ = (id) => el.shadowRoot.getElementById(id);
            // encrypted controls present
            expect($('syncbutton')).to.not.equal(null);
            expect($('exportkeybutton')).to.not.equal(null);
            expect($('importkeyinput')).to.not.equal(null);
            expect($('importkeybutton')).to.not.equal(null);
            expect($('copyegitclonebutton')).to.not.equal(null);
            expect($('gatewayaccountspan')).to.not.equal(null);
            // plaintext-era and toggle controls are gone
            expect($('copyclonebutton')).to.equal(null);
            expect($('copyconfigbutton')).to.equal(null);
            expect($('enableencryptedsyncbutton')).to.equal(null);
            expect($('disableencryptedsyncbutton')).to.equal(null);
            expect($('encryptedsyncstatus')).to.equal(null);
        });

        it('export key reveals the 64-hex master key', async () => {
            el.shadowRoot.getElementById('exportkeybutton').click();
            await until(() => /^[0-9a-f]{64}$/.test(el.shadowRoot.getElementById('exportedkey').textContent), 'the exported key');
            expect(el.shadowRoot.getElementById('exportedkey').textContent).to.equal(currentDekHex());
        });

        it('an unenrolled wallet key can import the exported key to enroll', async () => {
            // Device/wallet 1 created the store...
            const dek = await obtainDek();
            const dekHex = [...dek].map((b) => b.toString(16).padStart(2, '0')).join('');
            store.refsExists = true;
            // ...device/wallet 2 signs differently: not enrolled.
            __clearDekForTests();
            fakeWallet('test-ledger.near');

            el.shadowRoot.getElementById('importkeyinput').value = dekHex;
            el.shadowRoot.getElementById('importkeybutton').click();
            const importText = await dismissModal();
            expect(importText).to.contain('Key imported');
            expect(store.wraps.size).to.equal(2); // a second wrap for the new wallet key
            expect(currentDekHex()).to.equal(dekHex);
        });

        it('copy encrypted clone command renders a command with key and token', async () => {
            el.shadowRoot.getElementById('copyegitclonebutton').click();
            await until(() => el.shadowRoot.getElementById('egitclonecmd').textContent.startsWith('EGIT_KEY='), 'the clone command');
            const cmd = el.shadowRoot.getElementById('egitclonecmd').textContent;
            expect(cmd).to.equal(egitCloneCommand(currentDekHex(), 'test-token'));
        });
    });
});
