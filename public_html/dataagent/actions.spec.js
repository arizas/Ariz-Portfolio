import { setAccounts, getAccounts, getReceivedAccounts, getExpenseAccounts, setReceivedAccounts, setExpenseAccounts, getStoredRecordsFileInfo } from '../storage/domainobjectstore.js';
import { mockWalletAuthenticationData, mockArizGatewayAccess } from '../arizgateway/arizgatewayaccess.spec.js';
import { createDataSession } from './data-api.js';

// What the assistant may do, it may only propose: the owner approves, and then
// the app's own functions do it, the ones its pages' buttons call.

const ACCOUNT = 'petersalomonsen.near';

async function refused(promise) {
    try { await promise; } catch (error) { return error.message; }
    return null;
}

describe('the assistant\'s actions', function () {
    before(async () => {
        mockWalletAuthenticationData();
        await mockArizGatewayAccess();
        await setAccounts([ACCOUNT, 'other.near']);
        await setReceivedAccounts({});
        await setExpenseAccounts({});
    });

    it('fetches an account the way the Accounts page does, once approved', async function () {
        this.timeout(5 * 60000);
        const session = createDataSession();
        const proposal = await session.api.proposeChange({ op: 'fetchTransactions', args: { accounts: [ACCOUNT] } });
        expect(proposal.summary).to.match(/Free for an account the gateway already keeps up to date/);
        expect(await getStoredRecordsFileInfo(ACCOUNT)).to.equal(null);

        const result = await session.applyChange(proposal.id);
        expect(result.fetched[0].account).to.equal(ACCOUNT);
        expect(result.fetched[0].newTransactions).to.be.greaterThan(0);
        expect((await getStoredRecordsFileInfo(ACCOUNT)).records).to.be.greaterThan(0);
        // What was read before is read again after.
        expect((await session.api.describe({ dataset: 'records', account: ACCOUNT })).rows).to.be.greaterThan(0);
    });

    it('fetches only the portfolio\'s own accounts', async () => {
        const { api } = createDataSession();
        expect(await refused(api.proposeChange({ op: 'fetchTransactions', args: { accounts: ['stranger.near'] } }))).to.match(/not one of the portfolio's accounts/);
        expect(await refused(api.proposeChange({ op: 'fetchTransactions', args: { accounts: [] } }))).to.match(/must be a list/);
        expect(await refused(api.proposeChange({ op: 'fetchConfidentialHistory', args: { accountId: '../x' } }))).to.match(/not a valid NEAR account/);
    });

    it('sets a counterparty to one category, as the Counterparties page does', async () => {
        const session = createDataSession();
        const apply = async (args) => session.applyChange((await session.api.proposeChange({ op: 'setCounterparty', args })).id);
        await apply({ account: 'employer.near', category: 'received', description: 'salary' });
        expect(await getReceivedAccounts()).to.deep.equal({ 'employer.near': { description: 'salary' } });
        await apply({ account: 'employer.near', category: 'expense' });
        expect(await getReceivedAccounts()).to.deep.equal({});
        expect(await getExpenseAccounts()).to.deep.equal({ 'employer.near': { description: '' } });
        await apply({ account: 'employer.near', category: 'none' });
        expect(await getExpenseAccounts()).to.deep.equal({});
        expect(await refused(session.api.proposeChange({ op: 'setCounterparty', args: { account: 'a.near', category: 'income' } }))).to.match(/received, expense or none/);
    });

    it('stops tracking an account, and only a tracked one', async () => {
        const session = createDataSession();
        const { id, summary } = await session.api.proposeChange({ op: 'removeAccount', args: { accountId: 'other.near' } });
        expect(summary).to.match(/stored data stays/);
        await session.applyChange(id);
        expect(await getAccounts()).to.deep.equal([ACCOUNT]);
        expect(await refused(session.api.proposeChange({ op: 'removeAccount', args: { accountId: 'other.near' } }))).to.match(/not one of/);
    });

    it('opens a page in a new tab, and only the app\'s pages', async () => {
        const session = createDataSession();
        const opened = [];
        const realOpen = window.open;
        window.open = (url) => { opened.push(String(url)); return {}; };
        try {
            await session.applyChange((await session.api.proposeChange({ op: 'openPage', args: { page: 'year-summary-print', year: 2025, currency: 'NOK' } })).id);
            await session.applyChange((await session.api.proposeChange({ op: 'openPage', args: { page: 'storage' } })).id);
        } finally {
            window.open = realOpen;
        }
        expect(opened.map((url) => new URL(url).pathname + new URL(url).search)).to.deep.equal([
            `${new URL('.', location.href).pathname}yearsummary-alltokens-print?year=2025&month=0&nummonths=12&currency=nok`,
            `${new URL('.', location.href).pathname}storage`,
        ]);
        for (const page of ['https://evil.example', '../storage', 'delete', '__proto__']) {
            expect(await refused(session.api.proposeChange({ op: 'openPage', args: { page } })), page).to.match(/page must be one of/);
        }
    });

    it('applies a change once, even when approved twice at once', async () => {
        const session = createDataSession();
        const { id } = await session.api.proposeChange({ op: 'setCounterparty', args: { account: 'twice.near', category: 'received' } });
        const results = await Promise.allSettled([session.applyChange(id), session.applyChange(id)]);
        expect(results.map((r) => r.status).sort()).to.deep.equal(['fulfilled', 'rejected']);
        expect(results.find((r) => r.status === 'rejected').reason.message).to.match(/already being applied/);
    });
});
