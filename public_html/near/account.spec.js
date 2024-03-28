import { getAccountBalanceAfterTransaction, getNearblocksAccountHistory, getTransactionsToDate } from './account.js';
import { getTransactionsForAccount, fetchTransactionsForAccount } from '../storage/domainobjectstore.js';

describe.only('nearaccount transactions petersalomonsen.near', function () {
    const account = 'petersalomonsen.near';
    it('should get transactions, and then add new transactions on the next date', async function () {
        this.timeout(5 * 60000);
        let transactions = [];

        let block_timestamp = BigInt(new Date('2021-05-24').getTime()) * BigInt(1_000_000);
        const startPage = 170;
        const referenceTransactions = [];
        let page = startPage;
        while (true) {
            const refTransactionsPage = await getNearblocksAccountHistory(account, 25, page);
            refTransactionsPage.forEach(tx => {
                if (!referenceTransactions.find(reftx => reftx.hash === tx.hash)) {
                    referenceTransactions.push(tx)
                }
            });
            page++;
            if (refTransactionsPage.length == 0) {
                break;
            }
        }

        transactions = await getTransactionsToDate(account, block_timestamp, transactions, 25, startPage);

        let referenceTransactionsBeforeBlockTimestamp = referenceTransactions.filter(tx => BigInt(tx.block_timestamp) < block_timestamp);
        console.log(referenceTransactionsBeforeBlockTimestamp.length, transactions.length);
        expect(transactions.length).to.equal(referenceTransactionsBeforeBlockTimestamp.length);

        console.log('adding transactions the next date');
        block_timestamp = BigInt(new Date('2021-05-25').getTime()) * BigInt(1_000_000);
        referenceTransactionsBeforeBlockTimestamp = referenceTransactions.filter(tx => BigInt(tx.block_timestamp) < block_timestamp);

        transactions = await getTransactionsToDate(account, block_timestamp, transactions, 25, startPage);
        expect(referenceTransactionsBeforeBlockTimestamp.length).to.equal(transactions.length);

        for (let n = 0; n < referenceTransactionsBeforeBlockTimestamp.length; n++) {
            expect(transactions[n].hash).to.equal(referenceTransactionsBeforeBlockTimestamp[n].hash);
        }
        expect(transactions.length).to.equal(referenceTransactionsBeforeBlockTimestamp.length);

    });

    it('should get correct account balance after receipts are executed', async function () {
        this.timeout(20 * 60000);
        await fetchTransactionsForAccount(account, 1626977729473574682);
        const transactions = await getTransactionsForAccount(account);
        const chainedTx = transactions.filter(tx => tx.hash == 'Eepx9H8NJ5mxqtSrHojcuV3KZj9y5q6q4oFNWcbGJpnc');

        expect(chainedTx.length).to.equal(2);

        const txBeforeChainedTx = transactions[transactions.findIndex(tx => tx == chainedTx[1]) + 1];

        const balanceAfterLastTx = BigInt(await getAccountBalanceAfterTransaction(account, chainedTx[0].hash));
        const balanceAfterFirstTx = BigInt(await getAccountBalanceAfterTransaction(account, txBeforeChainedTx.hash));

        expect(Number(balanceAfterLastTx) / 1e+24).to.be.closeTo(Number(balanceAfterFirstTx - BigInt(chainedTx[1].args.deposit) + BigInt(chainedTx[0].args.deposit)) / 1e+24, 1);
        expect(BigInt(chainedTx[0].balance)).to.equal(balanceAfterLastTx);
    });
});
describe('nearaccount transactions psalomo.near', function () {
    let transactions = [];
    const account = 'psalomo.near';
    it('should get transactions for psalomo.near', async function () {
        this.timeout(10 * 60000);
        transactions = await getTransactionsToDate('psalomo.near', new Date('2021-04-01').getTime() * 1_000_000, [], 20);
        expect(transactions.find(t => t.args.method_name == 'buy_token' && t.block_timestamp == '1615409039200091358')).to.be.ok;
    });
});