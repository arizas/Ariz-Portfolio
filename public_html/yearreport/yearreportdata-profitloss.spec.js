import { calculateProfitLoss, calculateYearReportData, getConvertedValuesForDay } from './yearreportdata.js';
import { setAccounts, fetchTransactionsFromAccountingExport, getTransactionsForAccount, writeStakingData, writeTransactions, fetchFungibleTokenTransactionsForAccount, setCustomRealizationRates } from '../storage/domainobjectstore.js';
import { transactionsWithDeposits } from './yearreporttestdata.js'
import { fetchHistoricalPricesFromArizGateway, setCustomExchangeRateSell, setSkipFetchingPrices } from '../pricedata/pricedata.js';
import { mockWalletAuthenticationData, mockArizGatewayAccess } from '../arizgateway/arizgatewayaccess.spec.js';

describe('year-report-data-profitloss', () => {
    before(async function () {
        this.timeout(10 * 60000);
        mockWalletAuthenticationData();
        await mockArizGatewayAccess();
        await fetchHistoricalPricesFromArizGateway({ currency: 'NOK', todate: '2024-05-30' });
        await fetchHistoricalPricesFromArizGateway({ currency: 'USD', todate: '2024-05-30' });
        setSkipFetchingPrices('NEAR', 'NOK');
        setSkipFetchingPrices('NEAR', 'USD');
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
        expect(nearValues.realizations.length).to.be.greaterThan(0);
        expect(nearValues.realizations[0].position.conversionRate).to.be.greaterThan(0);
        expect(nearValues.loss).to.be.closeTo((nearValues.withdrawal * nearValues.realizations[0].position.conversionRate / 1e24) - 1285, 20);

        nearValues = yearReportData['2022-08-21'];
        convertedValues = await getConvertedValuesForDay(yearReportData['2022-08-21'], 'NOK', '2022-08-21');
        expect(nearValues.withdrawal).to.equal(2.000000849110125e+26);
        expect(convertedValues.withdrawal).to.be.closeTo(8200, 0.00001);

        expect((nearValues.profit - nearValues.loss)).to.be.closeTo(8200 - (nearValues.realizations.reduce((p, c) => {
            return p + c.initialConvertedValue;
        }, 0)), 12);
    });
    it('should use manually specified realization value for a specific transaction when calculating profit/loss and total withdrawal', async function () {
        this.timeout(10 * 60000);
        const account = 'psalomo.near';
        const convertToCurrency = 'NOK';

        await setAccounts([account]);
        await fetchTransactionsFromAccountingExport(account);

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
            .to.be.closeTo(customRealizationRatesObj['64YHGt8Tsp8x28ksvi1vWA3pv9sWs4AhRSAdWPUbtdEC'].realizationPrice, 0.05);
        expect(nearValues.withdrawal / Math.pow(10, 24)).to.be.closeTo(4.0, 0.01);
        expect(convertedValues.withdrawal).to.be.closeTo(203.68, 0.5);

        expect(nearValues.profit).to.be.closeTo(19.01, 0.5);
    });
    it('should calculate year report for fungible token USDC', async function () {
        this.timeout(10 * 60000);
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
        this.timeout(10 * 60000);
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
        const account = 'petermusic.near';
        const stakingPool = 'astro-stakers.poolv1.near';

        await setAccounts([account]);

        const aug29Balance = '8503000000000000000000000';
        const aug30BalanceAfterWithdraw = '1008503000000000000000000000';
        const aug30BalanceAfterDeposit = '8502000000000000000000000';

        const transactions = [
            {
                "block_hash": "HashAug30Withdraw",
                "block_timestamp": "1725062400000000000",
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
            {
                "block_hash": "HashAug30Deposit",
                "block_timestamp": "1725062500000000000",
                "hash": "DepositTxHash456",
                "action_index": 0,
                "signer_id": account,
                "receiver_id": stakingPool,
                "action_kind": "FUNCTION_CALL",
                "args": {
                    "gas": 125000000000000,
                    "deposit": "1000000000000000000000000000",
                    "args_json": {},
                    "args_base64": "e30=",
                    "method_name": "deposit_and_stake"
                },
                "balance": aug30BalanceAfterDeposit
            },
            {
                "block_hash": "HashAug29",
                "block_timestamp": "1724976000000000000",
                "hash": "BaselineTxHash789",
                "action_index": 0,
                "signer_id": "someother.near",
                "receiver_id": account,
                "action_kind": "TRANSFER",
                "args": {
                    "deposit": "100000000000000000000000"
                },
                "balance": aug29Balance
            }
        ];

        const stakingBalances = [
            {
                "timestamp": "2025-08-30T12:01:40.000Z",
                "balance": 1000000000000000000000000000,
                "block_height": 100000002,
                "epoch_id": "EpochAug30b",
                "next_epoch_id": "EpochAug31",
                "deposit": 1000000000000000000000000000,
                "withdrawal": 0,
                "earnings": 0
            },
            {
                "timestamp": "2025-08-30T12:00:00.000Z",
                "balance": 0,
                "block_height": 100000001,
                "epoch_id": "EpochAug30a",
                "next_epoch_id": "EpochAug30b",
                "deposit": 0,
                "withdrawal": 1000000000000000000000000000,
                "earnings": 0
            },
            {
                "timestamp": "2025-08-29T12:00:00.000Z",
                "balance": 1000000000000000000000000000,
                "block_height": 100000000,
                "epoch_id": "EpochAug29",
                "next_epoch_id": "EpochAug30a",
                "deposit": 0,
                "withdrawal": 0,
                "earnings": 100000000000000000000000
            }
        ];

        await writeTransactions(account, transactions);
        await writeStakingData(account, stakingPool, stakingBalances);

        const dailydata = (await calculateYearReportData()).dailyBalances;

        const aug30Data = dailydata['2025-08-30'];

        expect(aug30Data.deposit / 1e+24, 'Staking deposit should not count as actual deposit').to.be.closeTo(0, 0.01);
        expect(aug30Data.withdrawal / 1e+24, 'Staking withdrawal should not count as actual withdrawal').to.be.closeTo(0, 0.01);

        expect(aug30Data.totalChange / 1e+24, 'Total balance change should be close to 0 for staking restake').to.be.closeTo(0, 1);
    });
});
