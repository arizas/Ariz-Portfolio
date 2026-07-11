import { gitCloneCommand, gitConfigCommand, gatewayRepoUrl, prepareSyncRemote } from './storage-page.component.js';
import { mockWalletAuthenticationData } from '../arizgateway/arizgatewayaccess.spec.js';
import { setEncryptedSyncEnabled, __setTestServiceWorkerContainer } from '../arizgateway/encryptedsync.js';
import { __clearDekForTests } from '../arizgateway/encryptionkey.js';
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
        el.remove();
    });
});
