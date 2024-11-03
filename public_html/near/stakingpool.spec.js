import { fetchAllStakingEarnings, findStakingPoolsInTransactions, getAccountBalanceInPool, getBlockData, getBlockInfo, getStakingAccounts } from './stakingpool.js';
import { getTransactionsToDate } from './account.js';
import { fetchTransactionsForAccount, writeTransactions } from '../storage/domainobjectstore.js';
import { dokiacapitaltransactions, dokiaCapitalStakingBalances, nearDevGovStakingBalances } from '../../testdata/stakingbalances.js';

describe('stakingpool', () => {
    it('should get account balance', async function () {
        const balance = await getAccountBalanceInPool('openshards.poolv1.near', 'petersalomonsen.near', 122823074);
        expect(balance).to.equal(parseInt('256465402038997425102462871'));
    })
    it('should get latest block data and then get the same block data by block height', async function () {
        const blockdata = await getBlockInfo('final');
        const refBlockData = await getBlockInfo(blockdata.header.height);
        delete blockdata.header.chunk_endorsements;
        delete refBlockData.header.chunk_endorsements;
        expect(blockdata).to.deep.equal(refBlockData);
    });
    it('should get latest block data and then get block info by hash', async function () {
        const blockdata = await getBlockInfo('final');
        const blockInfo = await getBlockInfo(blockdata.header.hash);
        delete blockdata.header.chunk_endorsements;
        delete blockInfo.header.chunk_endorsements;
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
            if (stakingBalanceEntry.epoch_id !== stakingBalances[n + 1].epoch_id) {
                expect(stakingBalanceEntry.epoch_id).to.equal(stakingBalances[n + 1].next_epoch_id, `${JSON.stringify(stakingBalanceEntry, null, 1)}\n${JSON.stringify(stakingBalances[n + 1], null, 1)}`);
            }
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

    it('should handle re-staking in the same pool', async function () {
        const account_id = 'petersalomonsen.near';
        const stakingpool_id = 'neardevgov.poolv1.near';

        const stakingTransactions = [
            {
                block_hash: 'EqvVekayFaKU4qzTBa2hkRRVi4tRZ6TiFbkn5qABr3CX',
                block_timestamp: '1710577749873416321',
                hash: 'HQriCRcAbxttRWmz3LCQaRK5os1jaNhPSqda2Rwb5p4f',
                signer_id: 'petersalomonsen.near',
                receiver_id: 'neardevgov.poolv1.near',
                action_kind: 'FUNCTION_CALL',
                args: { method_name: 'deposit_and_stake' },
                block_height: 114812639,
                balance: '289892893215402145134832152'
            },
            {
                block_hash: '6TN47GHg7k28KDPQL72zRxWBhXcHpUPzWxn9k2vmPy2s',
                block_timestamp: '1710577671446260276',
                hash: 'J1zJ7XMaYvFuLyxKxR3kuVFwcCMtb8qoExZkBowHFgRT',
                signer_id: 'petersalomonsen.near',
                receiver_id: 'neardevgov.poolv1.near',
                action_kind: 'FUNCTION_CALL',
                args: { method_name: 'withdraw_all' },
                block_height: 114812581,
                balance: '389894181702489608434832152'
            },
            {
                block_hash: '5uc7RqzcZGrd1PCqKvzRoeWortesw3Pn318EMn1GRTM5',
                block_timestamp: '1710341895673443883',
                hash: '8L9herYruWMnDBpsQLmZUWdnpHp529289dtrbmFUCpo7',
                signer_id: 'petersalomonsen.near',
                receiver_id: 'neardevgov.poolv1.near',
                action_kind: 'FUNCTION_CALL',
                args: { method_name: 'unstake_all' },
                block_height: 114634819,
                balance: '13016672830145115485299667'
            },
            {
                block_hash: '24Zq2UbijVwD52NXfrR4MKcngZoz239DBWFb6VXgCM2s',
                block_timestamp: '1688668591697599600',
                hash: 'Af2ZfAHULc4Eh3KpctLtLARViaqo2c7aXgo5okkLJ7pz',
                action_index: 0,
                signer_id: 'petersalomonsen.near',
                receiver_id: 'neardevgov.poolv1.near',
                action_kind: 'FUNCTION_CALL',
                args: {
                    gas: 125000000000000,
                    deposit: '350000000000000000000000000',
                    args_json: {},
                    method_name: 'deposit_and_stake'
                },
                balance: '410368406246815598818050335'
            }
        ];
        await writeTransactions(account_id, stakingTransactions);

        const first_block = 114812639 + 43_200 * 3;
        const newStakingBalances = await fetchAllStakingEarnings(stakingpool_id, account_id, nearDevGovStakingBalances, first_block);

        const stakingBalancesOnReStakingDate = newStakingBalances.filter(st => st.timestamp.toJSON && st.timestamp.toJSON().startsWith('2024-03-16'));
        let sumEarnings = 0;
        let sumDeposit = 0;
        let sumWithdrawal = 0;
        for (const stakingBalance of stakingBalancesOnReStakingDate) {
            sumEarnings += stakingBalance.earnings;
            sumDeposit += stakingBalance.deposit;
            sumWithdrawal += stakingBalance.withdrawal;
        }
        expect(sumEarnings).to.equal(0);
        expect(sumWithdrawal / 1e+24).to.be.closeTo(376.885366, 0.0001);
        expect(sumDeposit).to.equal(100 * 1e+24);
    });

});
