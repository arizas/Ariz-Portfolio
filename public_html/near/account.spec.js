import { getAccountBalanceAfterTransaction, getHelperAccountHistory, getTransactionStatus, getTransactionsToDate, viewAccount } from './account.js';
import { getTransactionsForAccount, fetchTransactionsForAccount } from '../storage/domainobjectstore.js';

describe('nearaccount transactions petersalomonsen.near', function () {
    let transactions = [];
    const account = 'petersalomonsen.near';
    it('should get transactions to date', async () => {
        transactions = await getTransactionsToDate(account, new Date('2021-05-24').getTime() * 1_000_000, transactions, 3);
        expect(transactions.length).toBe(19);
        expect(transactions[16].block_timestamp).toBe('1621757638772495934');
        expect(transactions[17].block_timestamp).toBe('1621757638772495934');
        expect(transactions[18].block_timestamp).toBe('1621757638772495934');

        expect(transactions.filter(t => t.args?.args_base64 != undefined)).toEqual([]);
    }, 10000);
    it('should get transactions new transactions on the next date', async () => {
        transactions = await getTransactionsToDate(account, new Date('2021-05-25').getTime() * 1_000_000, transactions, 5);
        const allInOneChunkTransactions = await getHelperAccountHistory(account, 100, new Date('2021-05-25').getTime() * 1_000_000);
        expect(allInOneChunkTransactions.length).toBe(34);
        expect(transactions.length).toBe(allInOneChunkTransactions.length);

        for (let n = 0; n < allInOneChunkTransactions.length; n++) {
            expect(transactions[n].block_timestamp).toBe(allInOneChunkTransactions[n].block_timestamp);
            expect(transactions[n].hash).toBe(allInOneChunkTransactions[n].hash);
            expect(transactions.find(t => t.hash == allInOneChunkTransactions[n].hash && t.action_index == allInOneChunkTransactions[n].action_index)).toBeTruthy();
        }
    }, 20000);

    it('should get correct account balance after receipts are executed', async () => {
        await fetchTransactionsForAccount(account, 1626977729473574682);
        const transactions = await getTransactionsForAccount(account);
        const chainedTx = transactions.filter(tx => tx.hash == 'Eepx9H8NJ5mxqtSrHojcuV3KZj9y5q6q4oFNWcbGJpnc');

        expect(chainedTx.length).toBe(2);

        const txBeforeChainedTx = transactions[transactions.findIndex(tx => tx == chainedTx[1])+1];

        const balanceAfterLastTx = BigInt(await getAccountBalanceAfterTransaction(account, chainedTx[0].hash));
        const balanceAfterFirstTx = BigInt(await getAccountBalanceAfterTransaction(account, txBeforeChainedTx.hash));
        
        expect(Number(balanceAfterLastTx)/1e+24).toBeCloseTo(Number(balanceAfterFirstTx - BigInt(chainedTx[1].args.deposit) + BigInt(chainedTx[0].args.deposit))/1e+24,1);
        expect(BigInt(chainedTx[0].balance)).toBe(balanceAfterLastTx);
    }, 120000);
});
describe('nearaccount transactions psalomo.near', function () {
    let transactions = [];
    const account = 'psalomo.near';
    it('should get transactions for psalomo.near', async () => {
        transactions = await getTransactionsToDate('psalomo.near', new Date('2021-04-01').getTime() * 1_000_000, [], 20);
        expect(transactions.find(t => t.args.method_name == 'buy_token' && t.block_timestamp == '1615409039200091358')).toBeTruthy();
    }, 150000);
});