import { calculateProfitLoss, calculateYearReportData, getConvertedValuesForDay } from './yearreportdata.js';
import { setAccounts, fetchTransactionsForAccount, getTransactionsForAccount, writeStakingData, writeTransactions } from '../storage/domainobjectstore.js';
import { transactionsWithDeposits } from './yearreporttestdata.js'
import { setCustomExchangeRateSell } from '../pricedata/pricedata.js';

describe('year-report-data', () => {
    it('should get daily account balance report for psalomo.near', async function() {
        this.timeout(10*60000);
        const account = 'psalomo.near';
        const startDate = new Date(2021, 4, 1);
        const startDateString = startDate.toJSON().substring(0, 'yyyy-MM-dd'.length);
        await setAccounts([account]);
        await fetchTransactionsForAccount(account, startDate.getTime() * 1_000_000);
        const dailydata = await calculateYearReportData();
        const transactions = (await getTransactionsForAccount(account));
        let prevDate = startDateString;
        for (let n = 0; n < transactions.length; n++) {
            const tx = transactions[n];
            const txdate = new Date(tx.block_timestamp / 1_000_000).toJSON().substring(0, 'yyyy-MM-dd'.length);

            while (txdate.localeCompare(prevDate) <= 0) {
                expect(dailydata[prevDate].accountBalance).toEqual(BigInt(tx.balance));
                prevDate = new Date(new Date(prevDate).getTime() - 24 * 60 * 60 * 1000).toJSON().substring(0, 'yyyy-MM-dd'.length);
            }
        };
    });
    it('should get daily account balance report for two accounts', async function() {
        this.timeout(10*60000);
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
        const dailydata = await calculateYearReportData();
        let compareDate = startDateString;
        while (compareDate.localeCompare('2021-01-01') >= 0) {
            expect(dailydata[compareDate].accountBalance).to.equal(expectedDailyBalance[compareDate]);
            compareDate = new Date(new Date(compareDate).getTime() - 24 * 60 * 60 * 1000).toJSON().substring(0, 'yyyy-MM-dd'.length);
        }
    });
    it('should not report transfers between own accounts as deposits/withdrawals', async function() {
        const accounts = ['psalomo.near', 'petersalomonsen.near'];
        const verifyDate = '2021-07-24';
        await setAccounts(accounts);

        for (var account of accounts) {
            await fetchTransactionsForAccount(account, new Date(2021, 7, 1).getTime() * 1_000_000);
        }
        const dailydata = await calculateYearReportData();
        console.log(Number(dailydata[verifyDate].accountChange) / 1e+24,
            Number(dailydata[verifyDate].deposit) / 1e+24,
            Number(dailydata[verifyDate].withdrawal) / 1e+24);

    });
    it('should calculate profit / loss for withdrawals', async function() {
        this.timeout(10*60000);
        const account = 'psalomo.near';
        const startDate = new Date(2021, 4, 1);
        await setAccounts([account]);
        await fetchTransactionsForAccount(account, startDate.getTime() * 1_000_000);

        const { dailyBalances, openPositions, closedPositions } = await calculateProfitLoss(await calculateYearReportData(), 'NOK');

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
                expect(totalDayAmount).withContext(`total realized amount at ${datestring} should equal withdrawal amount. Open position amount ${openPositionAmountSum}, Closed position amount ${closedPositionAmountSum}`).toEqual(dayentry.withdrawal);
            }
            if (totalDayProfit || dayentry.profit) {
                expect(totalDayProfit).withContext(`profit for day ${datestring} with withdrawal ${dayentry.withdrawal} and closed profit sum ${closedProfitSum} and open profit sum ${openProfitSum} should equal daily calculated profit`).toEqual(dayentry.profit);
            }
            if (totalDayLoss || dayentry.loss) {
                expect(totalDayLoss).withContext(`loss for day ${datestring}`).toEqual(dayentry.loss);
            }
            totalProfit += dayentry.profit ?? 0;
            totalLoss += dayentry.loss ?? 0;
        };
        openPositions.filter(p => p.realizations.length).forEach(p => {
            const sumRealizationsAmount = p.realizations.reduce((p, c) => p + c.amount, 0);
            expect(p.remainingAmount).to.be.above(0);
            expect(Math.abs(p.remainingAmount - (p.initialAmount - sumRealizationsAmount))).withContext(`open positions remaining amount should equal the initial amount minus realized amount.`)
                .to.be.at.most(1e+12);
        });
        closedPositions.forEach(p =>
            p.realizations.forEach(r => {
                if (r.profit) {
                    expect(r.profit)
                        .withContext(`realization profit should equal realtization amount multiplied with conversionRate diffs. initial: ${p.conversionRate} (${p.date}), realized: ${r.conversionRate} (${r.date})`)
                        .to.be.closeTo(
                            (r.amount / Math.pow(10, 24)) * (r.conversionRate - p.conversionRate), 4
                        )
                } else {
                    expect(r.loss)
                        .withContext(`realization loss should equal realtization amount multiplied with conversionRate diffs. initial: ${p.conversionRate}, realized: ${r.conversionRate}`)
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
    it('should use previous epoch staking balance for days with no epoch', async function() {
        this.timeout(10*60000);
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
        const dailydata = await calculateYearReportData();
        expect(dailydata['2022-09-14'].stakingBalance).to.equal(1.5110166536686937e+26);
        expect(dailydata['2022-09-16'].stakingBalance).to.equal(1.5116177505287145e+26);
        expect(dailydata['2022-09-15'].stakingBalance).to.equal(1.5110166536686937e+26);
        expect(dailydata['2022-09-16'].stakingEarnings).to.equal(dailydata['2022-09-16'].stakingBalance - dailydata['2022-09-15'].stakingBalance);
        expect(dailydata['2022-09-15'].stakingEarnings).to.equal(dailydata['2022-09-15'].stakingBalance - dailydata['2022-09-14'].stakingBalance);
    });
    it('should be use manually specified withdrawal value when calculating profit/loss and total withdrawal', async function() {
        this.timeout(10*60000);
        const account = '6f32d9832f4b08752106a782aad702a3210e47906fce4a0cab7528feabd5736e';
        const convertToCurrency = 'NOK';
        const currentYear = 2022;

        await setAccounts([account]);
        await writeTransactions(account, transactionsWithDeposits);

        await setCustomExchangeRateSell('NOK', '2022-02-25', 1.681520098881095e+25, 1285);
        await setCustomExchangeRateSell('NOK','2022-08-21', 2.000000849110125e+26, 8200);
        const { dailyBalances } = await calculateProfitLoss(await calculateYearReportData(), convertToCurrency);

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
        expect(convertedValues.withdrawal).to.equal(1285);
        expect(nearValues.loss).to.be.closeTo((nearValues.withdrawal * nearValues.realizations[0].position.conversionRate / 1e24) - 1285, 12);

        nearValues = yearReportData['2022-08-21'];
        convertedValues = await getConvertedValuesForDay(yearReportData['2022-08-21'], 'NOK', '2022-08-21');
        expect(nearValues.withdrawal).to.equal(2.000000849110125e+26);
        expect(convertedValues.withdrawal).to.equal(8200);

        expect((nearValues.profit - nearValues.loss)).to.be.closeTo(8200 - (nearValues.realizations.reduce((p, c) => {
            return p + c.initialConvertedValue;
        }, 0)), 12);
    });
});