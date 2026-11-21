import { accountsconfigfile, getAccounts, setAccounts } from './domainobjectstore.js';
import { exists } from './gitstorage.js';

// Each spec file gets a fresh in-memory store, so this one starts out like a
// device that has never added an account or synchronized.
describe('a device with no data', () => {
    it('has an empty account list, not a missing-file error', async () => {
        expect(await exists(accountsconfigfile)).to.equal(false);
        expect(await getAccounts()).to.deep.equal([]);
    });

    it('reads the account list once one is saved', async () => {
        await setAccounts(['alice.near']);
        expect(await getAccounts()).to.deep.equal(['alice.near']);
    });
});
