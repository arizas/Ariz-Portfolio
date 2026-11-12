import { setAccounts, getAccounts, getReceivedAccounts, getExpenseAccounts, setReceivedAccounts, setExpenseAccounts, getStoredRecordsFileInfo, writeAccountingRecords, getStoredRecordsForAccount, getNearCopyChoices } from '../storage/domainobjectstore.js';
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

    describe('a NEAR movement stored twice', function () {
        // other.near: one withdrawal at block 221111269, where the balance moved,
        // and again at 221111265 with the same receipt.
        const Y = (near) => (BigInt(Math.round(near * 1e4)) * 10n ** 20n).toString();
        const copy = (block) => ({
            block_height: block, block_timestamp: '2026-10-22T15:38:51.263Z', tx_hash: 'DTJZ3FQK', tx_block: null,
            signer_id: null, receiver_id: 'other.near', predecessor_id: 'intents.near', receipt_id: 'HrwfSfUV',
            counterparty: 'intents.near', token_id: 'near', amount: Y(2.2893), balance_before: Y(35.6028), balance_after: Y(37.8921),
        });
        const store = () => writeAccountingRecords('other.near', { version: 2, accountId: 'other.near', records: [copy(221111269), copy(221111265)], metadata: {} });
        const readerOf = (balanceAt) => () => async (blocks) => new Map(blocks.map((b) => [b, Y(balanceAt(b))]));
        before(() => setAccounts([ACCOUNT, 'other.near']));

        it('is listed apart from real breaks, with the key to decide it by', async () => {
            await store();
            const { api } = createDataSession();
            const result = await api.balanceBreaks({ account: 'other.near' });
            expect(result.nearCopyCount).to.equal(1);
            expect(result.nearCopies[0].blocks).to.deep.equal([221111265, 221111269]);
            expect(result.nearCopies[0].sameReceipt).to.be.true;
            expect(result.breaks.every((b) => b.copyOf === result.nearCopies[0].key)).to.be.true;
        });

        it('is not put to the owner when the chain settles it', async () => {
            await store();
            const { api } = createDataSession({ nearBalancesFor: readerOf((b) => (b >= 221111269 ? 37.8921 : 35.6028)) });
            const { nearCopies: [{ key }] } = await api.balanceBreaks({ account: 'other.near' });
            expect(await refused(api.proposeChange({ op: 'keepNearCopy', args: { account: 'other.near', key, keep: 221111269 } })))
                .to.match(/the chain settles these rows/);
        });

        it('says what the app could not decide, and keeps the owner\'s choice for later fetches', async () => {
            await store();
            const session = createDataSession({ nearBalancesFor: readerOf(() => 35.6028) });
            const { nearCopies: [{ key }] } = await session.api.balanceBreaks({ account: 'other.near' });
            expect(await refused(session.api.proposeChange({ op: 'keepNearCopy', args: { account: 'other.near', key, keep: 5 } })))
                .to.match(/keep must be one of the blocks 221111265, 221111269/);

            const proposal = await session.api.proposeChange({ op: 'keepNearCopy', args: { account: 'other.near', key, keep: 221111269 } });
            expect(proposal.summary).to.equal('other.near: blocks 221111265 and 221111269 each record 2.2893 NEAR received from intents.near, with the same receipt. '
                + 'The chain shows this change at none of these blocks, so the app cannot tell which row is right. '
                + 'Keep the row at block 221111269 and remove the other. This choice is kept for later fetches');
            expect(await session.applyChange(proposal.id)).to.deep.equal({ removed: 1 });
            expect((await getStoredRecordsForAccount('other.near')).map((r) => r.block_height)).to.deep.equal([221111269]);
            expect((await getNearCopyChoices('other.near'))[key].keep).to.equal(221111269);
        });
    });
});
