import { calculateProfitLoss, calculateYearReportData } from './yearreportdata.js';
import { setAccounts, fetchTransactionsForAccount, getTransactionsForAccount } from '../storage/domainobjectstore.js';

describe('year-report-data', () => {
    it('should get daily account balance report for psalomo.near', async () => {
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
    }, 120000);
    it('should get daily account balance report for two accounts', async () => {
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
            expect(dailydata[compareDate].accountBalance).toBe(expectedDailyBalance[compareDate]);
            compareDate = new Date(new Date(compareDate).getTime() - 24 * 60 * 60 * 1000).toJSON().substring(0, 'yyyy-MM-dd'.length);
        }
    }, 120000);
    it('should not report transfers between own accounts as deposits/withdrawals', async () => {
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
        
    }, 60000);
    it('should calculate profit / loss for withdrawals', async () => {
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
            expect(p.remainingAmount).toBeGreaterThan(0);
            expect(Math.abs(p.remainingAmount-(p.initialAmount - sumRealizationsAmount))).withContext(`open positions remaining amount should equal the initial amount minus realized amount.`)
                .toBeLessThanOrEqual(1e+12);
        });
        closedPositions.forEach(p =>
            p.realizations.forEach(r => {
                if (r.profit) {
                    expect(r.profit)
                    .withContext(`realization profit should equal realtization amount multiplied with conversionRate diffs. initial: ${p.conversionRate} (${p.date}), realized: ${r.conversionRate} (${r.date})`)
                    .toBeCloseTo(
                            (r.amount / Math.pow(10,24)) * (r.conversionRate - p.conversionRate),4
                    )
                } else {
                    expect(r.loss)
                    .withContext(`realization loss should equal realtization amount multiplied with conversionRate diffs. initial: ${p.conversionRate}, realized: ${r.conversionRate}`)
                    .toBeCloseTo(
                            (r.amount / Math.pow(10,24)) * (p.conversionRate - r.conversionRate),4
                    )
                }
            })
        );

        const closedPositionsTotalProfit = closedPositions.reduce((p, c) => p + c.realizations.reduce((p, c) => p + c.profit, 0), 0);
        const openPositionsTotalProfit = openPositions.reduce((p, c) => p + c.realizations.reduce((p, c) => p + c.profit, 0), 0);
        const closedPositionsTotalLoss = closedPositions.reduce((p, c) => p + c.realizations.reduce((p, c) => p + c.loss, 0), 0);
        const openPositionsTotalLoss = openPositions.reduce((p, c) => p + c.realizations.reduce((p, c) => p + c.loss, 0), 0);

        expect(totalProfit).toBeCloseTo(openPositionsTotalProfit + closedPositionsTotalProfit,4);
        expect(totalLoss).toBeCloseTo(openPositionsTotalLoss + closedPositionsTotalLoss,4);
    }, 120000);
});