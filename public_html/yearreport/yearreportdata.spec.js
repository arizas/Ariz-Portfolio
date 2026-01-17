import { calculateProfitLoss, calculateYearReportData, getConvertedValuesForDay } from './yearreportdata.js';
import { setAccounts, fetchTransactionsForAccount, getTransactionsForAccount, writeStakingData, writeTransactions, fetchFungibleTokenTransactionsForAccount, setCustomRealizationRates, setDepositAccounts } from '../storage/domainobjectstore.js';
import { transactionsWithDeposits } from './yearreporttestdata.js'
import { fetchNEARHistoricalPricesFromNearBlocks, fetchNOKPrices, setCustomExchangeRateSell } from '../pricedata/pricedata.js';

describe('year-report-data', () => {
    beforeEach(async () => {
        await fetchNEARHistoricalPricesFromNearBlocks();
        await fetchNOKPrices();
    });
    it('should get daily account balance report for psalomo.near', async function () {
        this.timeout(10 * 60000);
        const account = 'psalomo.near';
        const startDate = new Date(2021, 4, 1);
        const startDateString = startDate.toJSON().substring(0, 'yyyy-MM-dd'.length);
        await setAccounts([account]);
        await fetchTransactionsForAccount(account, startDate.getTime() * 1_000_000);
        const dailydata = (await calculateYearReportData()).dailyBalances;
        const transactions = (await getTransactionsForAccount(account));
        let prevDate = startDateString;
        for (let n = 0; n < transactions.length; n++) {
            const tx = transactions[n];
            const txdate = new Date(tx.block_timestamp / 1_000_000).toJSON().substring(0, 'yyyy-MM-dd'.length);

            while (txdate.localeCompare(prevDate) <= 0) {
                expect(dailydata[prevDate].accountBalance).to.equal(BigInt(tx.balance));
                prevDate = new Date(new Date(prevDate).getTime() - 24 * 60 * 60 * 1000).toJSON().substring(0, 'yyyy-MM-dd'.length);
            }
        };
    });
    it('should get daily account balance report for two accounts', async function () {
        this.timeout(10 * 60000);
        const accounts = ['psalomo.near', 'wasmgit.near'];
        await setAccounts(accounts);
        const expectedDailyBalance = {};
        const startDate = new Date(2021, 4, 1);
        const startDateString = startDate.toJSON().substring(0, 'yyyy-MM-dd'.length);

        for (var account of accounts) {
            await fetchTransactionsForAccount(account, new Date(2021, 4, 1).getTime() * 1_000_000);
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
        let compareDate = startDateString;
        while (compareDate.localeCompare('2021-01-01') >= 0) {
            expect(dailydata[compareDate].accountBalance).to.equal(expectedDailyBalance[compareDate]);
            compareDate = new Date(new Date(compareDate).getTime() - 24 * 60 * 60 * 1000).toJSON().substring(0, 'yyyy-MM-dd'.length);
        }
    });
    it('should not report transfers between own accounts as deposits/withdrawals', async function () {
        this.timeout(20 * 60000);
        const accounts = ['psalomo.near', 'wasmgit.near'];
        const verifyDate = '2021-02-14';
        await setAccounts(accounts);
        await setDepositAccounts({'02cf3e779cbe6e75cc2cfd36a86a2315639b522435b04a34c694d95c8e4404db': "for creating wasm-git"});

        for (var account of accounts) {
            await fetchTransactionsForAccount(account, new Date(2021, 1, 15).getTime() * 1_000_000);
        }
        const dailydata = (await calculateYearReportData()).dailyBalances;
        expect(Number(dailydata[verifyDate].accountChange) / 1e+24).to.be.closeTo(5.96, 0.005);
        expect(Number(dailydata[verifyDate].received) / 1e+24).to.be.closeTo(0.0, 0.005);
        expect(Number(dailydata[verifyDate].deposit) / 1e+24).to.be.closeTo(11.99, 0.005);
        expect(Number(dailydata[verifyDate].withdrawal) / 1e+24).to.be.closeTo(0.03, 0.005);
    });
    it('should calculate profit / loss for withdrawals', async function () {
        this.timeout(10 * 60000);
        await fetchNEARHistoricalPricesFromNearBlocks();
        await fetchNOKPrices();

        const account = 'psalomo.near';
        const startDate = new Date(2021, 4, 1);
        await setAccounts([account]);
        await fetchTransactionsForAccount(account, startDate.getTime() * 1_000_000);

        const { dailyBalances, openPositions, closedPositions } = await calculateProfitLoss((await calculateYearReportData()).dailyBalances, 'NOK');

        let totalProfit = 0;
        let totalLoss = 0;
        for (let datestring in dailyBalances) {
            const dayentry = dailyBalances[datestring];
            const openPositionAmountSum = openPositions.reduce((p, c) => p + c.realizations.filter(r => r.date == datestring).reduce((p, c) => p + c.amount, 0), 0);
            const closedPositionAmountSum = closedPositions.reduce((p, c) => p + c.realizations.filter(r => r.date == datestring).reduce((p, c) => p + c.amount, 0), 0);
            const totalDayAmount = openPositionAmountSum + closedPositionAmountSum;
            const openProfitSum = openPositions.reduce((p, c) => p + c.realizations.filter(r => r.date == datestring).reduce((p, c) => p + c.profit, 0), 0);
            const closedProfitSum = closedPositions.reduce((p, c) => p + c.realizations.filter(r => r.date == datestring).reduce((p, c) => p + c.profit, 0), 0);
            const openLossSum = openPositions.reduce((p, c) => p + c.realizations.filter(r => r.date == datestring).reduce((p, c) => p + c.loss, 0), 0);
            const closedLossSum = closedPositions.reduce((p, c) => p + c.realizations.filter(r => r.date == datestring).reduce((p, c) => p + c.loss, 0), 0);
            const totalDayProfit = openProfitSum + closedProfitSum;
            const totalDayLoss = openLossSum + closedLossSum;

            if (totalDayAmount || dayentry.withdrawal) {
                expect(totalDayAmount, `total realized amount at ${datestring} should equal withdrawal amount. Open position amount ${openPositionAmountSum}, Closed position amount ${closedPositionAmountSum}`).to.equal(dayentry.withdrawal);
            }
            if (totalDayProfit || dayentry.profit) {
                expect(totalDayProfit, `profit for day ${datestring} with withdrawal ${dayentry.withdrawal} and closed profit sum ${closedProfitSum} and open profit sum ${openProfitSum} should equal daily calculated profit`).to.equal(dayentry.profit);
            }
            if (totalDayLoss || dayentry.loss) {
                expect(totalDayLoss, `loss for day ${datestring}`).to.equal(dayentry.loss);
            }
            totalProfit += dayentry.profit ?? 0;
            totalLoss += dayentry.loss ?? 0;
        };
        openPositions.filter(p => p.realizations.length).forEach(p => {
            const sumRealizationsAmount = p.realizations.reduce((p, c) => p + c.amount, 0);
            expect(p.remainingAmount).to.be.above(0);
            expect(Math.abs(p.remainingAmount - (p.initialAmount - sumRealizationsAmount)), `open positions remaining amount should equal the initial amount minus realized amount.`)
                .to.be.at.most(1e+12);
        });
        closedPositions.forEach(p =>
            p.realizations.forEach(r => {
                if (r.profit) {
                    expect(r.profit, `realization profit should equal realtization amount multiplied with conversionRate diffs. initial: ${p.conversionRate} (${p.date}), realized: ${r.conversionRate} (${r.date})`)
                        .to.be.closeTo(
                            (r.amount / Math.pow(10, 24)) * (r.conversionRate - p.conversionRate), 4
                        )
                } else {
                    expect(r.loss, `realization loss should equal realtization amount multiplied with conversionRate diffs. initial: ${p.conversionRate}, realized: ${r.conversionRate}`)
                        .to.be.closeTo(
                            (r.amount / Math.pow(10, 24)) * (p.conversionRate - r.conversionRate), 4
                        )
                }
            })
        );

        const closedPositionsTotalProfit = closedPositions.reduce((p, c) => p + c.realizations.reduce((p, c) => p + c.profit, 0), 0);
        const openPositionsTotalProfit = openPositions.reduce((p, c) => p + c.realizations.reduce((p, c) => p + c.profit, 0), 0);
        const closedPositionsTotalLoss = closedPositions.reduce((p, c) => p + c.realizations.reduce((p, c) => p + c.loss, 0), 0);
        const openPositionsTotalLoss = openPositions.reduce((p, c) => p + c.realizations.reduce((p, c) => p + c.loss, 0), 0);

        expect(totalProfit).to.be.closeTo(openPositionsTotalProfit + closedPositionsTotalProfit, 4);
        expect(totalLoss).to.be.closeTo(openPositionsTotalLoss + closedPositionsTotalLoss, 4);
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
        // Reproduces bug from petermusic.near on 2025-08-30 where the reward showed
        // 1,000,389 instead of 0,389 because the deposit wasn't being subtracted from earnings
        this.timeout(10 * 60000);
        const account = 'stakingtest.near';
        const stakingPool = 'astro-stakers.poolv1.near';

        await setAccounts([account]);

        // Staking data with deposit on 2025-08-30 - entries sorted by block height DESC
        const stakingBalances = [
            // Aug 30 - epoch after deposit
            {
                timestamp: '2025-08-30T09:49:10.402Z',
                balance: 1442967093064936394199457858, // ~1442.9 NEAR
                block_height: 161870400,
                deposit: 0,
                withdrawal: 0,
                earnings: 118064229313394572005863 // ~0.118 NEAR (correct epoch reward)
            },
            // Aug 30 - deposit entry (1000 NEAR deposited)
            {
                timestamp: '2025-08-30T09:37:23.054Z',
                balance: 1442848977056627936899944430, // ~1442.8 NEAR after deposit
                block_height: 161869264,
                deposit: 1000000000000000000000000000, // 1000 NEAR deposit
                withdrawal: 0,
                earnings: 35726021191301072898723 // ~0.035 NEAR (small diff, deposit subtracted)
            },
            // Aug 30 - epoch before deposit
            {
                timestamp: '2025-08-30T02:30:36.786Z',
                balance: 442813251789670864000720706, // ~442.8 NEAR before deposit
                block_height: 161827200,
                deposit: 0,
                withdrawal: 0,
                earnings: 35777045952135626730289 // ~0.035 NEAR
            },
            // Aug 29 - previous day
            {
                timestamp: '2025-08-29T14:11:03.605Z',
                balance: 442777474743718728373990417, // ~442.7 NEAR
                block_height: 161784000,
                deposit: 0,
                withdrawal: 0,
                earnings: 0
            }
        ];

        // Transaction for the deposit
        const transactions = [
            {
                block_hash: 'SomeHash',
                block_timestamp: '1756563443054815700', // Aug 30
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

        // The staking earnings on Aug 30 should be the sum of actual earnings
        // NOT including the 1000 NEAR deposit amount
        // Expected: ~0.118 + ~0.035 + ~0.035 = ~0.188 NEAR (the actual staking rewards)
        const aug30Earnings = dailydata['2025-08-30'].stakingEarnings;

        // Earnings should be around 0.2 NEAR (actual staking rewards for the day)
        expect(aug30Earnings / 1e24, 'Staking earnings should be ~0.2 NEAR').to.be.closeTo(0.2, 0.5);

        // Earnings should NOT be ~1000 NEAR (which would happen if deposit wasn't tracked)
        expect(aug30Earnings / 1e24, 'Staking earnings should NOT be ~1000 NEAR').to.be.lessThan(10);
    });
    it('should be use manually specified withdrawal value when calculating profit/loss and total withdrawal', async function () {
        this.timeout(10 * 60000);
        const account = '6f32d9832f4b08752106a782aad702a3210e47906fce4a0cab7528feabd5736e';
        const convertToCurrency = 'NOK';
        const currentYear = 2022;

        await setAccounts([account]);
        await writeTransactions(account, transactionsWithDeposits);

        await setCustomExchangeRateSell('NOK', '2022-02-25', 1.681520098881095e+25, 1285);
        await setCustomExchangeRateSell('NOK', '2022-08-21', 2.000000849110125e+26, 8200);
        const { dailyBalances } = await calculateProfitLoss((await calculateYearReportData()).dailyBalances, convertToCurrency);

        const yearReportData = dailyBalances;

        let currentDate = new Date().getFullYear() === currentYear ? new Date(new Date(new Date().getTime() - 24 * 60 * 60 * 1000).toJSON().substring(0, 'yyyy-MM-dd'.length)) : new Date(`${currentYear}-12-31`);
        const endDate = new Date(`${currentYear}-01-01`);

        let totalDeposit = 0;
        let totalWithdrawal = 0;
        let totalProfit = 0;
        let totalLoss = 0;

        while (currentDate.getTime() >= endDate) {
            const datestring = currentDate.toJSON().substring(0, 'yyyy-MM-dd'.length);

            const rowdata = yearReportData[datestring];

            const { deposit, withdrawal } = await getConvertedValuesForDay(rowdata, convertToCurrency, datestring);

            totalDeposit += deposit;
            totalWithdrawal += withdrawal;
            totalProfit += rowdata.profit ?? 0;
            totalLoss += rowdata.loss ?? 0;

            currentDate = new Date(currentDate.getTime() - 24 * 60 * 60 * 1000);
        }

        let nearValues = yearReportData['2022-02-25'];
        let convertedValues = await getConvertedValuesForDay(yearReportData['2022-02-25'], 'NOK', '2022-02-25');
        expect(nearValues.withdrawal).to.equal(1.681520098881095e+25);
        expect(convertedValues.withdrawal).to.be.closeTo(1285, 0.01);
        expect(nearValues.loss).to.be.closeTo((nearValues.withdrawal * nearValues.realizations[0].position.conversionRate / 1e24) - 1285, 12);

        nearValues = yearReportData['2022-08-21'];
        convertedValues = await getConvertedValuesForDay(yearReportData['2022-08-21'], 'NOK', '2022-08-21');
        expect(nearValues.withdrawal).to.equal(2.000000849110125e+26);
        expect(convertedValues.withdrawal).to.be.closeTo(8200, 0.00001);

        expect((nearValues.profit - nearValues.loss)).to.be.closeTo(8200 - (nearValues.realizations.reduce((p, c) => {
            return p + c.initialConvertedValue;
        }, 0)), 12);
    });
    it('should use manually specified realization value for a specific transaction when calculating profit/loss and total withdrawal', async function () {
        const account = 'psalomo.near';
        const convertToCurrency = 'NOK';

        const startDate = new Date(2021, 4, 1);
        await setAccounts([account]);
        await fetchTransactionsForAccount(account, startDate.getTime() * 1_000_000);

        const customRealizationRatesObj = {
            "64YHGt8Tsp8x28ksvi1vWA3pv9sWs4AhRSAdWPUbtdEC": {
                "realizationTime": "2021-04-18T05:13:52.000Z",
                "realizationPrice": 50.87,
                "realizationCurrency": "NOK"
            }
        };

        await setCustomRealizationRates(customRealizationRatesObj);

        let { dailyBalances, transactionsByDate } = await calculateYearReportData();
        dailyBalances = (await calculateProfitLoss(dailyBalances, convertToCurrency)).dailyBalances;
        const nearValues = dailyBalances['2021-04-17'];
        const convertedValues = await getConvertedValuesForDay(dailyBalances['2021-04-17'], 'NOK', '2021-04-17');

        expect(nearValues.convertToCurrencyWithdrawalAmount / (nearValues.withdrawal / Math.pow(10, 24)))
            .to.be.closeTo(customRealizationRatesObj['64YHGt8Tsp8x28ksvi1vWA3pv9sWs4AhRSAdWPUbtdEC'].realizationPrice, 0.01);
        expect(nearValues.withdrawal / Math.pow(10, 24)).to.be.closeTo(4.0, 0.01);
        expect(convertedValues.withdrawal).to.be.closeTo(203.68, 0.01);

        expect(nearValues.profit).to.be.closeTo(18.84, 0.01);
    });
    it('should calculate year report for fungible token USDC', async function () {
        const account = 'petersalomonsen.near';
        const startDate = new Date(2024, 3, 12);
        const startDateString = startDate.toJSON().substring(0, 'yyyy-MM-dd'.length);
        await setAccounts([account]);
        await fetchFungibleTokenTransactionsForAccount(account, startDate.getTime() * 1_000_000);
        const dailydata = (await calculateYearReportData('USDC')).dailyBalances;
        const transactions = (await getTransactionsForAccount(account));
        let prevDate = startDateString;
        for (let n = 0; n < transactions.length; n++) {
            const tx = transactions[n];
            const txdate = new Date(tx.block_timestamp / 1_000_000).toJSON().substring(0, 'yyyy-MM-dd'.length);
            while (txdate.localeCompare(prevDate) <= 0) {
                expect(dailydata[prevDate].accountBalance).to.equal(BigInt(tx.balance));
                prevDate = new Date(new Date(prevDate).getTime() - 24 * 60 * 60 * 1000).toJSON().substring(0, 'yyyy-MM-dd'.length);
            }
        };
        expect(dailydata['2024-04-12'].accountBalance).to.equal(4563n);
        expect(dailydata['2024-01-12'].accountBalance).to.equal(6441000000n);
    });
    it('should calculate year report for fungible token USDT', async function () {
        const account = 'petersalomonsen.near';
        const startDate = new Date(2024, 3, 12);
        const startDateString = startDate.toJSON().substring(0, 'yyyy-MM-dd'.length);
        await setAccounts([account]);
        await fetchFungibleTokenTransactionsForAccount(account, startDate.getTime() * 1_000_000);
        const dailydata = (await calculateYearReportData('USDt')).dailyBalances;
        const transactions = (await getTransactionsForAccount(account));
        let prevDate = startDateString;
        for (let n = 0; n < transactions.length; n++) {
            const tx = transactions[n];
            const txdate = new Date(tx.block_timestamp / 1_000_000).toJSON().substring(0, 'yyyy-MM-dd'.length);
            while (txdate.localeCompare(prevDate) <= 0) {
                expect(dailydata[prevDate].accountBalance).to.equal(BigInt(tx.balance));
                prevDate = new Date(new Date(prevDate).getTime() - 24 * 60 * 60 * 1000).toJSON().substring(0, 'yyyy-MM-dd'.length);
            }
        };
        expect(dailydata['2023-10-26'].accountBalance).to.equal(2825000000n);
    });
    it('should not report staking withdrawal and re-deposit as balance changes', async function () {
        this.timeout(10 * 60000);
        // Reproduces bug from petermusic.near on 2025-08-30/31 where staking withdrawal
        // and new deposit incorrectly showed as +1000/-1000 NEAR total balance changes
        const account = 'petermusic.near';
        const stakingPool = 'astro-stakers.poolv1.near';

        await setAccounts([account]);

        // Aug 29 balance before any staking changes
        const aug29Balance = '8503000000000000000000000'; // ~8.503 NEAR account balance
        // Aug 30: withdraw_all from staking pool, then deposit_and_stake to new pool
        // Account balance temporarily increases then decreases
        const aug30BalanceAfterWithdraw = '1008503000000000000000000000'; // ~1008.503 NEAR (after withdraw)
        const aug30BalanceAfterDeposit = '8502000000000000000000000'; // ~8.502 NEAR (after re-deposit)

        // Transactions simulating: withdraw from old pool, deposit to new pool
        const transactions = [
            // Aug 30: withdraw_all from staking pool
            {
                "block_hash": "HashAug30Withdraw",
                "block_timestamp": "1725062400000000000", // 2025-08-30T12:00:00Z
                "hash": "WithdrawTxHash123",
                "action_index": 0,
                "signer_id": account,
                "receiver_id": stakingPool,
                "action_kind": "FUNCTION_CALL",
                "args": {
                    "gas": 125000000000000,
                    "deposit": "0",
                    "args_json": {},
                    "args_base64": "e30=",
                    "method_name": "withdraw_all"
                },
                "balance": aug30BalanceAfterWithdraw
            },
            // Aug 30: deposit_and_stake to same pool (re-stake)
            {
                "block_hash": "HashAug30Deposit",
                "block_timestamp": "1725062500000000000", // 2025-08-30T12:01:40Z
                "hash": "DepositTxHash456",
                "action_index": 0,
                "signer_id": account,
                "receiver_id": stakingPool,
                "action_kind": "FUNCTION_CALL",
                "args": {
                    "gas": 125000000000000,
                    "deposit": "1000000000000000000000000000", // 1000 NEAR
                    "args_json": {},
                    "args_base64": "e30=",
                    "method_name": "deposit_and_stake"
                },
                "balance": aug30BalanceAfterDeposit
            },
            // Aug 29: earlier transaction to establish baseline
            {
                "block_hash": "HashAug29",
                "block_timestamp": "1724976000000000000", // 2025-08-29T12:00:00Z
                "hash": "BaselineTxHash789",
                "action_index": 0,
                "signer_id": "someother.near",
                "receiver_id": account,
                "action_kind": "TRANSFER",
                "args": {
                    "deposit": "100000000000000000000000" // 0.1 NEAR received
                },
                "balance": aug29Balance
            }
        ];

        // Staking balances showing the withdrawal and re-deposit
        const stakingBalances = [
            {
                "timestamp": "2025-08-30T12:01:40.000Z",
                "balance": 1000000000000000000000000000, // 1000 NEAR after re-deposit
                "block_height": 100000002,
                "epoch_id": "EpochAug30b",
                "next_epoch_id": "EpochAug31",
                "deposit": 1000000000000000000000000000, // 1000 NEAR deposited
                "withdrawal": 0,
                "earnings": 0
            },
            {
                "timestamp": "2025-08-30T12:00:00.000Z",
                "balance": 0, // 0 after withdraw_all
                "block_height": 100000001,
                "epoch_id": "EpochAug30a",
                "next_epoch_id": "EpochAug30b",
                "deposit": 0,
                "withdrawal": 1000000000000000000000000000, // 1000 NEAR withdrawn
                "earnings": 0
            },
            {
                "timestamp": "2025-08-29T12:00:00.000Z",
                "balance": 1000000000000000000000000000, // 1000 NEAR before withdrawal
                "block_height": 100000000,
                "epoch_id": "EpochAug29",
                "next_epoch_id": "EpochAug30a",
                "deposit": 0,
                "withdrawal": 0,
                "earnings": 100000000000000000000000 // 0.1 NEAR daily reward
            }
        ];

        await writeTransactions(account, transactions);
        await writeStakingData(account, stakingPool, stakingBalances);

        const dailydata = (await calculateYearReportData()).dailyBalances;

        // On Aug 30, the staking withdrawal and re-deposit should NOT affect total balance
        // The deposit/withdrawal columns should be 0 for staking operations
        const aug30Data = dailydata['2025-08-30'];

        // These should be 0 because they are staking operations, not actual deposits/withdrawals
        expect(aug30Data.deposit / 1e+24, 'Staking deposit should not count as actual deposit').to.be.closeTo(0, 0.01);
        expect(aug30Data.withdrawal / 1e+24, 'Staking withdrawal should not count as actual withdrawal').to.be.closeTo(0, 0.01);

        // Total balance change should be close to 0 (only staking rewards)
        // Not +1000 NEAR or -1000 NEAR
        expect(aug30Data.totalChange / 1e+24, 'Total balance change should be close to 0 for staking restake').to.be.closeTo(0, 1);
    });
});