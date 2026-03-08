import { calculateProfitLoss, calculateYearReportData, getConvertedValuesForDay } from './yearreportdata.js';
import { setAccounts, fetchTransactionsFromAccountingExport, getTransactionsForAccount, writeStakingData, writeTransactions, fetchFungibleTokenTransactionsForAccount, setCustomRealizationRates, setDepositAccounts, setReceivedAccounts } from '../storage/domainobjectstore.js';
import { transactionsWithDeposits } from './yearreporttestdata.js'
import { fetchHistoricalPricesFromArizGateway, setCustomExchangeRateSell, setSkipFetchingPrices } from '../pricedata/pricedata.js';
import { mockWalletAuthenticationData, mockArizGatewayAccess } from '../arizgateway/arizgatewayaccess.spec.js';

describe('year-report-data', () => {
    before(async function () {
        this.timeout(10 * 60000);
        mockWalletAuthenticationData();
        await mockArizGatewayAccess();
        await fetchHistoricalPricesFromArizGateway({ currency: 'NOK', todate: '2024-05-30' });
        await fetchHistoricalPricesFromArizGateway({ currency: 'USD', todate: '2024-05-30' });
        setSkipFetchingPrices('NEAR', 'NOK');
        setSkipFetchingPrices('NEAR', 'USD');
    });
    it('should get daily account balance report for psalomo.near', async function () {
        this.timeout(10 * 60000);
        const account = 'psalomo.near';
        const startDate = new Date(2021, 4, 1);
        const startDateString = startDate.toJSON().substring(0, 'yyyy-MM-dd'.length);
        await setAccounts([account]);
        await fetchTransactionsFromAccountingExport(account);
        const dailydata = (await calculateYearReportData()).dailyBalances;
        const transactions = (await getTransactionsForAccount(account));
        const mismatches = [];
        let prevDate = startDateString;
        for (let n = 0; n < transactions.length; n++) {
            const tx = transactions[n];
            const txdate = new Date(tx.block_timestamp / 1_000_000).toJSON().substring(0, 'yyyy-MM-dd'.length);

            while (txdate.localeCompare(prevDate) <= 0) {
                if (dailydata[prevDate].accountBalance !== BigInt(tx.balance)) {
                    mismatches.push(`${prevDate}: got ${dailydata[prevDate].accountBalance}, expected ${BigInt(tx.balance)}`);
                }
                prevDate = new Date(new Date(prevDate).getTime() - 24 * 60 * 60 * 1000).toJSON().substring(0, 'yyyy-MM-dd'.length);
            }
        };
        expect(mismatches, 'Balance mismatches found').to.deep.equal([]);
    });
    it('should get daily account balance report for two accounts', async function () {
        this.timeout(10 * 60000);
        const accounts = ['psalomo.near', 'wasmgit.near'];
        await setAccounts(accounts);
        const expectedDailyBalance = {};
        const startDate = new Date(2021, 4, 1);
        const startDateString = startDate.toJSON().substring(0, 'yyyy-MM-dd'.length);

        for (var account of accounts) {
            await fetchTransactionsFromAccountingExport(account);
            const transactions = (await getTransactionsForAccount(account));
            let prevDate = startDateString;
            for (let n = 0; n < transactions.length; n++) {
                const tx = transactions[n];
                const txdate = new Date(tx.block_timestamp / 1_000_000).toJSON().substring(0, 'yyyy-MM-dd'.length);

                while (txdate.localeCompare(prevDate) <= 0) {
                    if (!expectedDailyBalance[prevDate]) {
                        expectedDailyBalance[prevDate] = BigInt(0);
                    }
                    expectedDailyBalance[prevDate] += BigInt(tx.balance);
                    prevDate = new Date(new Date(prevDate).getTime() - 24 * 60 * 60 * 1000).toJSON().substring(0, 'yyyy-MM-dd'.length);
                }
            };
        }
        const dailydata = (await calculateYearReportData()).dailyBalances;
        const mismatches = [];
        let compareDate = startDateString;
        while (compareDate.localeCompare('2021-01-01') >= 0) {
            if (expectedDailyBalance[compareDate] !== undefined && dailydata[compareDate].accountBalance !== expectedDailyBalance[compareDate]) {
                mismatches.push(`${compareDate}: got ${dailydata[compareDate].accountBalance}, expected ${expectedDailyBalance[compareDate]}`);
            }
            compareDate = new Date(new Date(compareDate).getTime() - 24 * 60 * 60 * 1000).toJSON().substring(0, 'yyyy-MM-dd'.length);
        }
        expect(mismatches, 'Balance mismatches found').to.deep.equal([]);
    });
    it('should not report transfers between own accounts as deposits/withdrawals', async function () {
        this.timeout(20 * 60000);
        const accounts = ['psalomo.near', 'wasmgit.near'];
        const verifyDate = '2021-02-14';
        await setAccounts(accounts);
        await setReceivedAccounts({});

        for (var account of accounts) {
            await fetchTransactionsFromAccountingExport(account);
        }
        const dailydata = (await calculateYearReportData()).dailyBalances;
        expect(Number(dailydata[verifyDate].accountChange) / 1e+24).to.be.closeTo(5.96, 0.005);
        // With inverted classification: all external incoming is deposit by default
        // 0.1 NEAR from "near" root account + 11.89 deposit = ~11.99 total deposit
        expect(Number(dailydata[verifyDate].received) / 1e+24).to.be.closeTo(0, 0.005);
        expect(Number(dailydata[verifyDate].deposit) / 1e+24).to.be.closeTo(11.99, 0.005);
        expect(Number(dailydata[verifyDate].withdrawal) / 1e+24).to.be.closeTo(0.03, 0.005);
    });
    it('should classify incoming from receivedaccounts as received (not deposit)', async function () {
        this.timeout(20 * 60000);
        const accounts = ['psalomo.near', 'wasmgit.near'];
        const verifyDate = '2021-02-14';
        await setAccounts(accounts);
        // Mark "near" root account as external received (e.g. account creation grant)
        await setReceivedAccounts({'near': { description: 'NEAR root account - account creation' }});

        for (var account of accounts) {
            await fetchTransactionsFromAccountingExport(account);
        }
        const dailydata = (await calculateYearReportData()).dailyBalances;
        expect(Number(dailydata[verifyDate].accountChange) / 1e+24).to.be.closeTo(5.96, 0.005);
        // 0.1 NEAR from "near" root account classified as received
        expect(Number(dailydata[verifyDate].received) / 1e+24).to.be.closeTo(0.1, 0.005);
        expect(Number(dailydata[verifyDate].deposit) / 1e+24).to.be.closeTo(11.89, 0.005);
        expect(Number(dailydata[verifyDate].withdrawal) / 1e+24).to.be.closeTo(0.03, 0.005);
    });
    it('should use previous epoch staking balance for days with no epoch', async function () {
        this.timeout(10 * 60000);
        const account = 'lala.near';
        const stakingPool = 'abcd.poolv1.near';

        await setAccounts([account]);

        const stakingBalances = [{
            "timestamp": "2022-09-16T16:26:49.640Z",
            "balance": 1.5116177505287145e+26,
            "block_height": 74274690,
            "epoch_id": "At98gwswXFicEfPtcYvikdvS4nvU17YP7TD4uRDtYGUE",
            "next_epoch_id": "3Nwhup7ntUtpLWx5owLhu6hEYNFSQuqmhiuFErAv6cqw",
            "deposit": 0,
            "withdrawal": 0,
            "earnings": 3.0052131027245517e+22
        },
        {
            "timestamp": "2022-09-16T00:49:48.666Z",
            "balance": 1.511317229218442e+26,
            "block_height": 74231490,
            "epoch_id": "CmWmJ8eNQhXsUvdcC87Xt6mt6qMQNCYc29a81o5FL5Hr",
            "next_epoch_id": "At98gwswXFicEfPtcYvikdvS4nvU17YP7TD4uRDtYGUE",
            "deposit": 0,
            "withdrawal": 0,
            "earnings": 3.0057554974833264e+22
        },
        {
            "timestamp": "2022-09-14T16:43:01.848Z",
            "balance": 1.5110166536686937e+26,
            "block_height": 74145847,
            "epoch_id": "6nom9bfnE8wt3ewpMtypix6K5qP11dkEAg8epVjRF4L8",
            "next_epoch_id": "CmWmJ8eNQhXsUvdcC87Xt6mt6qMQNCYc29a81o5FL5Hr",
            "deposit": 0,
            "withdrawal": 0,
            "earnings": 2.963318358229918e+22
        },
        {
            "timestamp": "2022-09-14T16:25:42.848Z",
            "balance": 1.5107203218328707e+26,
            "block_height": 74145089,
            "epoch_id": "39zW9KWiM9YTmTG3eripKE2FCbJ4BTHr2UnsjfK17u6f",
            "next_epoch_id": "6nom9bfnE8wt3ewpMtypix6K5qP11dkEAg8epVjRF4L8",
            "deposit": 0,
            "withdrawal": 0,
            "earnings": 2.886092263781928e+22
        }];

        const transactions = [
            {
                "block_hash": "D8JF63KbkDeYrDw1sEYYZ1F1yBt32acMKEY81QywGL6R",
                "block_timestamp": "1661107762431181199",
                "hash": "7h8rb1UMCeDsVzgdFryDRRhm85UFxq6NBFa7qkP2ysSC",
                "action_index": 0,
                "signer_id": account,
                "receiver_id": stakingPool,
                "action_kind": "FUNCTION_CALL",
                "args": {
                    "gas": 125000000000000,
                    "deposit": "150000000000000000000000000",
                    "args_json": {},
                    "args_base64": "e30=",
                    "method_name": "deposit_and_stake"
                },
                "balance": "193319504748993944327549190"
            }
        ];

        await writeTransactions(account, transactions);
        await writeStakingData(account, stakingPool, stakingBalances);
        const dailydata = (await calculateYearReportData()).dailyBalances;
        expect(dailydata['2022-09-14'].stakingBalance).to.equal(1.5110166536686937e+26);
        expect(dailydata['2022-09-16'].stakingBalance).to.equal(1.5116177505287145e+26);
        expect(dailydata['2022-09-15'].stakingBalance).to.equal(1.5110166536686937e+26);
        expect(dailydata['2022-09-16'].stakingEarnings).to.equal(dailydata['2022-09-16'].stakingBalance - dailydata['2022-09-15'].stakingBalance);
        expect(dailydata['2022-09-15'].stakingEarnings).to.equal(dailydata['2022-09-15'].stakingBalance - dailydata['2022-09-14'].stakingBalance);
    });
    it('should calculate correct staking earnings when deposit occurs - reward should NOT include deposit amount', async function () {
        this.timeout(10 * 60000);
        const account = 'stakingtest.near';
        const stakingPool = 'astro-stakers.poolv1.near';

        await setAccounts([account]);

        const stakingBalances = [
            {
                timestamp: '2025-08-30T09:49:10.402Z',
                balance: 1442967093064936394199457858,
                block_height: 161870400,
                deposit: 0,
                withdrawal: 0,
                earnings: 118064229313394572005863
            },
            {
                timestamp: '2025-08-30T09:37:23.054Z',
                balance: 1442848977056627936899944430,
                block_height: 161869264,
                deposit: 1000000000000000000000000000,
                withdrawal: 0,
                earnings: 35726021191301072898723
            },
            {
                timestamp: '2025-08-30T02:30:36.786Z',
                balance: 442813251789670864000720706,
                block_height: 161827200,
                deposit: 0,
                withdrawal: 0,
                earnings: 35777045952135626730289
            },
            {
                timestamp: '2025-08-29T14:11:03.605Z',
                balance: 442777474743718728373990417,
                block_height: 161784000,
                deposit: 0,
                withdrawal: 0,
                earnings: 0
            }
        ];

        const transactions = [
            {
                block_hash: 'SomeHash',
                block_timestamp: '1756563443054815700',
                hash: 'ADRV4zdG7fPXQE6dSYwTkzGsueEnitznKecp89CjaAsm',
                action_index: 0,
                signer_id: account,
                receiver_id: stakingPool,
                action_kind: 'FUNCTION_CALL',
                args: {
                    gas: 50000000000000,
                    deposit: '1000000000000000000000000000',
                    args_json: {},
                    args_base64: 'e30=',
                    method_name: 'deposit_and_stake'
                },
                balance: '8501757738090454900000001'
            }
        ];

        await writeTransactions(account, transactions);
        await writeStakingData(account, stakingPool, stakingBalances);

        const dailydata = (await calculateYearReportData()).dailyBalances;

        const aug30Earnings = dailydata['2025-08-30'].stakingEarnings;

        expect(aug30Earnings / 1e24, 'Staking earnings should be ~0.2 NEAR').to.be.closeTo(0.2, 0.5);

        expect(aug30Earnings / 1e24, 'Staking earnings should NOT be ~1000 NEAR').to.be.lessThan(10);
    });
});

