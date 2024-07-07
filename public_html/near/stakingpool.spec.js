import { fetchAllStakingEarnings, findStakingPoolsInTransactions, getAccountBalanceInPool, getBlockData } from './stakingpool.js';
import { getTransactionsToDate } from './account.js';
import { fetchTransactionsForAccount } from '../storage/domainobjectstore.js';

describe('stakingpool', () => {
    it('should get account balance', async function() {
        const balance = await getAccountBalanceInPool('openshards.poolv1.near','petersalomonsen.near', 122823074);
        expect(balance).to.equal(parseInt('256465402038997425102462871'));
    })
    it('should get latest block data and then get the same block data by block height', async function() {
        const blockdata = await getBlockData('final');
        const refBlockData = await getBlockData(blockdata.header.height);
        expect(blockdata).to.deep.equal(refBlockData);
    });
    it('should fetch staking balances', async function() {
        this.timeout(20*60000);
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
        }
    });

    it('it should identity staking pool accounts in transactions', async function() {
        this.timeout(10*60000);
        const transactions = await getTransactionsToDate('psalomo.near', new Date('2021-05-01').getTime() * 1_000_000);
        const stakingAccounts = findStakingPoolsInTransactions(transactions);
        expect(stakingAccounts.filter(a => a.endsWith('.poolv1.near')).length).to.equal(stakingAccounts.length);
    });
});
