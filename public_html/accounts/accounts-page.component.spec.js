import './accounts-page.component.js';

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