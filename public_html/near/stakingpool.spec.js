import { fetchAllStakingEarnings, findStakingPoolsInTransactions, getAccountBalanceInPool, getBlockData, getBlockInfo, getStakingAccounts } from './stakingpool.js';
import { getTransactionsToDate } from './account.js';
import { fetchTransactionsForAccount, writeTransactions } from '../storage/domainobjectstore.js';
import { stakingBalances } from '../../testdata/stakingbalances.js';

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
        this.timeout(60_000);
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

    it('should not fetch from staking pools with no balance ( should not re-fetch old balances )', async function () {
        this.timeout(10_000);
        const account_id = 'petersalomonsen.near';
        const stakingpool_id = 'dokiacapital.poolv1.near';

        const stakingTransactions = [
            {
                block_hash: 'HRNCVGdq8RtbeTEAmyjbjrHSFqAg5sQrMRveaHkALvE5',
                block_timestamp: '1700805291286078571',
                hash: 'Gu7kjCsPaoYQUdQpvxHm6L2LvStZ6go7AGFypQWpNCJx',
                action_index: 0,
                signer_id: 'dokiacapital.poolv1.near',
                receiver_id: 'petersalomonsen.near',
                action_kind: 'TRANSFER',
                args: { deposit: '107781876121379430562795333' },
                balance: '140070757487458768247810272'
            },
            {
                block_hash: 'ByGmv11KH9T8N1ULwLMXN31BJ1upMf8Ry5Rfi2v4ZMC4',
                block_timestamp: '1700805289955243055',
                hash: 'Gu7kjCsPaoYQUdQpvxHm6L2LvStZ6go7AGFypQWpNCJx',
                action_index: 0,
                signer_id: 'petersalomonsen.near',
                receiver_id: 'dokiacapital.poolv1.near',
                action_kind: 'FUNCTION_CALL',
                args: {
                    gas: 175000000000000,
                    deposit: '0',
                    args_json: {},
                    method_name: 'withdraw_all'
                },
                balance: '140070757487458768247810272'
            },
            {
                block_hash: '9pSfArFzMaVHGL98N4pQZNU5FqCxCgogkfTqiqxHLA5Z',
                block_timestamp: '1700501307576148206',
                hash: '8b3CKnA6y7PKHr4TFz6X4ntJ4PHWtQTHpkdtzqkbHL4e',
                action_index: 0,
                signer_id: 'petersalomonsen.near',
                receiver_id: 'dokiacapital.poolv1.near',
                action_kind: 'FUNCTION_CALL',
                args: {
                    gas: 125000000000000,
                    deposit: '0',
                    args_json: {},
                    method_name: 'unstake_all'
                },
                balance: '28550460865852622885014943'
            },
            {
                block_hash: '2BbALSrcbohGrUxujSrDbVYG6TsNKhUE3VBqnNHkAeJ6',
                block_timestamp: '1670965041080322963',
                hash: '4syZCwYR9MdRvfPPV1FCt6XPtdSQX2PGyfA58tcbBy4w',
                action_index: 0,
                signer_id: 'petersalomonsen.near',
                receiver_id: 'dokiacapital.poolv1.near',
                action_kind: 'FUNCTION_CALL',
                args: {
                    gas: 125000000000000,
                    deposit: '100000000000000000000000000',
                    args_json: {},
                    method_name: 'deposit_and_stake'
                },
                balance: '35952228543679286747001536'
            },
            {
                block_hash: '991n8RQDRHSMP54aKLorU2thwdU6U6CXzQzB3NQM4H2x',
                block_timestamp: '1670965004801621827',
                hash: 'GJof1hwvnEtw3TpV5K9XZwpQfxrYgM2af38EHmdUnZSW',
                action_index: 0,
                signer_id: 'dokiacapital.poolv1.near',
                receiver_id: 'petersalomonsen.near',
                action_kind: 'TRANSFER',
                args: { deposit: '111780575950537918979824444' },
                balance: '135953495946786343047001536'
            },
            {
                block_hash: 'A2rbaqpKfiY3471AfGkxQEB5hLkBKMJYQEdSwBTQEADx',
                block_timestamp: '1670965003692394709',
                hash: 'GJof1hwvnEtw3TpV5K9XZwpQfxrYgM2af38EHmdUnZSW',
                action_index: 0,
                signer_id: 'petersalomonsen.near',
                receiver_id: 'dokiacapital.poolv1.near',
                action_kind: 'FUNCTION_CALL',
                args: {
                    gas: 175000000000000,
                    deposit: '0',
                    args_json: {},
                    method_name: 'withdraw_all'
                },
                balance: '135953495946786343047001536'
            },
            {
                block_hash: 'BD7d8dMnUHrUKbwJdmoMminzP89z6GifY3L7WtEVmtmf',
                block_timestamp: '1670648821661501076',
                hash: '8EDs6Rn1LPmG5hFopCErGTTYA5YTGxEbNeBNb37Jkrfg',
                action_index: 0,
                signer_id: 'petersalomonsen.near',
                receiver_id: 'dokiacapital.poolv1.near',
                action_kind: 'FUNCTION_CALL',
                args: {
                    gas: 125000000000000,
                    deposit: '0',
                    args_json: {},
                    method_name: 'unstake_all'
                },
                balance: '24190526013605135667177092'
            },
            {
                block_hash: 'BLvLAPGrsdsfN9TfoJzTDqxXgrrnG2hE5RoGUBPCPzay',
                block_timestamp: '1635612819158468503',
                hash: 'FShAiHofxY2MA6KEvnPoeQyyP9stAs7n91m3LAGASKPY',
                action_index: 0,
                signer_id: 'petersalomonsen.near',
                receiver_id: 'dokiacapital.poolv1.near',
                action_kind: 'FUNCTION_CALL',
                args: {
                    gas: 125000000000000,
                    deposit: '100000000000000000000000000',
                    args_json: {},
                    args_base64: 'e30=',
                    method_name: 'deposit_and_stake'
                },
                balance: '57076767884778730300000000'
            }
        ];
        await writeTransactions(account_id, stakingTransactions);

        const first_block = 106501900 + 43_200 * 3;
        const newStakingBalances = await fetchAllStakingEarnings(stakingpool_id, account_id, stakingBalances, first_block);
        
        expect(newStakingBalances.length).to.equal(stakingBalances.length);
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
