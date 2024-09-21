import { fetchAllStakingEarnings, findStakingPoolsInTransactions, getAccountBalanceInPool, getBlockData, getBlockInfo, getStakingAccounts } from './stakingpool.js';
import { getTransactionsToDate } from './account.js';
import { fetchTransactionsForAccount, writeTransactions } from '../storage/domainobjectstore.js';
import { dokiacapitaltransactions, dokiaCapitalStakingBalances } from '../../testdata/stakingbalances.js';

describe('stakingpool', () => {
    it('should get account balance', async function () {
        const balance = await getAccountBalanceInPool('openshards.poolv1.near', 'petersalomonsen.near', 122823074);
        expect(balance).to.equal(parseInt('256465402038997425102462871'));
    })
    it('should get latest block data and then get the same block data by block height', async function () {
        const blockdata = await getBlockData('final');
        const refBlockData = await getBlockData(blockdata.header.height);
        expect(blockdata).to.deep.equal(refBlockData);
    });
    it('should get latest block data and then get block info by hash', async function () {
        const blockdata = await getBlockData('final');
        const blockInfo = await getBlockInfo(blockdata.header.hash);
        expect(blockdata.header).to.deep.equal(blockInfo.header);
    });
    it('should fetch staking balances', async function () {
        this.timeout(5 * 60_000);
        const account_id = 'psalomo.near';
        const stakingpool_id = '01node.poolv1.near';

        await fetchTransactionsForAccount(account_id, new Date('2021-05-14').getTime() * 1_000_000);
        let stakingBalances = [];
        const first_block = 31789506;
        stakingBalances = await fetchAllStakingEarnings(stakingpool_id, account_id, stakingBalances, first_block);
        const firstStakingBalance = stakingBalances[stakingBalances.length - 1];
        expect(firstStakingBalance.timestamp.toJSON().substring(0, 'yyyy-mm-dd'.length)).to.equal('2021-02-14');

        const firstStakingBalanceChunk = stakingBalances.slice();

        stakingBalances = await fetchAllStakingEarnings(stakingpool_id, account_id, stakingBalances, 37039379);

        expect(stakingBalances.slice(stakingBalances.length - firstStakingBalanceChunk.length)).to.deep.equal(firstStakingBalanceChunk);
        expect(stakingBalances.length).to.be.above(firstStakingBalanceChunk.length);
        expect(firstStakingBalance.timestamp.toJSON().substring(0, 'yyyy-mm-dd'.length)).to.equal('2021-02-14');
        expect(stakingBalances[0].timestamp.toJSON().substring(0, 'yyyy-mm-dd'.length)).to.equal('2021-05-05');
        for (var n = 0; n < stakingBalances.length - 1; n++) {
            const stakingBalanceEntry = stakingBalances[n];

            expect(stakingBalanceEntry.balance).to.equal(
                stakingBalances[n + 1].balance +
                stakingBalanceEntry.earnings +
                stakingBalanceEntry.deposit -
                stakingBalanceEntry.withdrawal
            );
            expect(stakingBalanceEntry.epoch_id).to.equal(stakingBalances[n + 1].next_epoch_id, `${JSON.stringify(stakingBalanceEntry, null, 1)}\n${JSON.stringify(stakingBalances[n + 1], null, 1)}`);
        }
    });

    it('should not fetch from staking pools with no balance ( should not re-fetch old balances )', async function () {
        this.timeout(10_000);
        const account_id = 'petersalomonsen.near';
        const stakingpool_id = 'dokiacapital.poolv1.near';

        const stakingTransactions = dokiacapitaltransactions;
        await writeTransactions(account_id, stakingTransactions);

        const first_block = 106501900 + 43_200 * 3;
        const newStakingBalances = await fetchAllStakingEarnings(stakingpool_id, account_id, dokiaCapitalStakingBalances, first_block);

        expect(newStakingBalances.length).to.equal(dokiaCapitalStakingBalances.length);
    });

    it('should identify staking pool accounts in transactions', async function () {
        this.timeout(10 * 60000);
        const transactions = await getTransactionsToDate('psalomo.near', new Date('2021-05-01').getTime() * 1_000_000);
        const stakingAccounts = findStakingPoolsInTransactions(transactions);
        expect(stakingAccounts.filter(a => a.endsWith('.poolv1.near')).length).to.equal(stakingAccounts.length);
    });

    it('should fetch staking pool accounts', async function () {
        const accountId = 'psalomo.near';
        await fetchTransactionsForAccount(accountId, new Date('2021-05-14').getTime() * 1_000_000);
        const stakingAccounts = await getStakingAccounts(accountId);

        for (const stakingAccount of [
            '01node.poolv1.near',
            'nodeasy.poolv1.near',
            'epic.poolv1.near',
            'inotel.poolv1.near',
            'moonlet.poolv1.near',
            'rekt.poolv1.near'
        ]) {
            expect(stakingAccounts).to.contain(stakingAccount);
        }
    });

});
