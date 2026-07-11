import { gitCloneCommand, gitConfigCommand, gatewayRepoUrl, prepareSyncRemote, egitCloneCommand } from './storage-page.component.js';
import { arizgatewayhost } from '../arizgateway/arizgatewayaccess.js';
import { mockWalletAuthenticationData } from '../arizgateway/arizgatewayaccess.spec.js';
import { isEncryptedSyncEnabled, setEncryptedSyncEnabled, __setTestServiceWorkerContainer } from '../arizgateway/encryptedsync.js';
import { __clearDekForTests, obtainDek, currentDekHex } from '../arizgateway/encryptionkey.js';
import { fakeWallet, mockStore } from '../arizgateway/encryptionkey.mock.js';
import { fakeSwContainer } from '../arizgateway/encryptedsync.mock.js';
import { __setTestWallet } from '../arizgateway/arizgatewayaccess.js';

describe('storage-page component', () => {
    before(() => {
        // A fake wallet so the component can resolve the signed-in account without
        // loading the real wallet UI / hitting the network.
        mockWalletAuthenticationData('test.near');
    });

    it('builds a clone command passing the NEP-413 token as an http.extraHeader', () => {
        const cmd = gitCloneCommand('TOKEN123');
        expect(cmd).to.contain('http.extraHeader="Authorization: Bearer TOKEN123"');
        expect(cmd).to.contain(`clone ${gatewayRepoUrl()}`);
        expect(cmd.startsWith('git -c ')).to.equal(true);
        expect(gatewayRepoUrl()).to.contain('/git/');
    });

    it('builds a git config command to refresh an expired token in an existing clone', () => {
        expect(gitConfigCommand('TOKEN123')).to.equal('git config http.extraHeader "Authorization: Bearer TOKEN123"');
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
            setEncryptedSyncEnabled(false);
            store.restore();
            __setTestWallet(null);
            __setTestServiceWorkerContainer(null);
            localStorage.removeItem('ariz_gateway_access_token');
        });

        it('uses the plaintext gateway git remote when encrypted sync is off', async () => {
            setEncryptedSyncEnabled(false);
            expect(await prepareSyncRemote()).to.equal(gatewayRepoUrl());
            expect(sw.registerCalls.length).to.equal(0);
        });

        it('when enabled: configures the service worker and returns /egit/<account>', async () => {
            setEncryptedSyncEnabled(true);
            const url = await prepareSyncRemote();
            expect(url).to.equal(`${location.origin}/egit/test.near`);
            expect(sw.registerCalls.length).to.equal(1);
            expect(sw.active.messages.length).to.equal(1);
            expect(sw.active.messages[0].type).to.equal('egit-set-key');
            expect(sw.active.messages[0].repoId).to.equal('test.near');
        });
    });

    it('renders the new UI without the legacy access-key / remote-url inputs', async () => {
        const el = document.createElement('storage-page');
        document.body.appendChild(el);
        await el.readyPromise;
        const $ = (id) => el.shadowRoot.getElementById(id);
        // legacy inputs are gone
        expect($('wasmgitaccesskey')).to.equal(null);
        expect($('remoterepo')).to.equal(null);
        // new controls are present
        expect($('syncbutton')).to.not.equal(null);
        expect($('copyclonebutton')).to.not.equal(null);
        expect($('copyconfigbutton')).to.not.equal(null);
        expect($('gatewayaccountspan')).to.not.equal(null);
        // encrypted sync controls are present
        expect($('encryptedsyncstatus')).to.not.equal(null);
        expect($('enableencryptedsyncbutton')).to.not.equal(null);
        expect($('disableencryptedsyncbutton')).to.not.equal(null);
        expect($('exportkeybutton')).to.not.equal(null);
        expect($('importkeyinput')).to.not.equal(null);
        expect($('importkeybutton')).to.not.equal(null);
        expect($('copyegitclonebutton')).to.not.equal(null);
        el.remove();
    });

    it('builds an encrypted clone command with the key, auth and egit:: remote', () => {
        const cmd = egitCloneCommand('ab'.repeat(32), 'TOKEN123');
        expect(cmd).to.contain(`EGIT_KEY=${'ab'.repeat(32)}`);
        expect(cmd).to.contain('EGIT_AUTH="Bearer TOKEN123"');
        expect(cmd).to.contain(`git clone "egit::${arizgatewayhost}/store/me"`);
    });

    describe('encrypted sync UI flows', () => {
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
            setEncryptedSyncEnabled(false);
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
            setEncryptedSyncEnabled(false);
            store.restore();
            __setTestWallet(null);
            __setTestServiceWorkerContainer(null);
            localStorage.removeItem('ariz_gateway_access_token');
        });

        it('enable: sets up the key + service worker, flips the flag and status', async () => {
            expect(el.shadowRoot.getElementById('encryptedsyncstatus').innerText).to.equal('disabled');
            el.shadowRoot.getElementById('enableencryptedsyncbutton').click();
            const text = await dismissModal();
            expect(text).to.contain('Encrypted sync enabled');
            expect(isEncryptedSyncEnabled()).to.equal(true);
            expect(store.wraps.size).to.equal(1); // first-setup stored a key wrap
            expect(sw.active.messages[0].type).to.equal('egit-set-key');
            expect(el.shadowRoot.getElementById('encryptedsyncstatus').innerText).to.equal('enabled');
            expect(el.shadowRoot.getElementById('enableencryptedsyncbutton').disabled).to.equal(true);

            el.shadowRoot.getElementById('disableencryptedsyncbutton').click();
            expect(isEncryptedSyncEnabled()).to.equal(false);
            expect(el.shadowRoot.getElementById('encryptedsyncstatus').innerText).to.equal('disabled');
        });

        it('export key reveals the 64-hex master key', async () => {
            el.shadowRoot.getElementById('exportkeybutton').click();
            await until(() => /^[0-9a-f]{64}$/.test(el.shadowRoot.getElementById('exportedkey').textContent), 'the exported key');
            expect(el.shadowRoot.getElementById('exportedkey').textContent).to.equal(currentDekHex());
        });

        it('an unenrolled wallet key gets the enrollment modal, then imports the exported key', async () => {
            // Device/wallet 1 created the store...
            const dek = await obtainDek();
            const dekHex = [...dek].map((b) => b.toString(16).padStart(2, '0')).join('');
            store.refsExists = true;
            // ...device/wallet 2 signs differently: not enrolled.
            __clearDekForTests();
            fakeWallet('test-ledger.near');

            el.shadowRoot.getElementById('enableencryptedsyncbutton').click();
            const text = await dismissModal();
            expect(text).to.contain('exported key');
            expect(isEncryptedSyncEnabled()).to.equal(false);

            el.shadowRoot.getElementById('importkeyinput').value = dekHex;
            el.shadowRoot.getElementById('importkeybutton').click();
            const importText = await dismissModal();
            expect(importText).to.contain('Key imported');
            expect(isEncryptedSyncEnabled()).to.equal(true);
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
