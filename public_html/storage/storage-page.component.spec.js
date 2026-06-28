import { gitCloneCommand, gitConfigCommand, gatewayRepoUrl } from './storage-page.component.js';
import { mockWalletAuthenticationData } from '../arizgateway/arizgatewayaccess.spec.js';

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
