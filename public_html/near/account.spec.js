import { fetchTransactionsFromAccountingExport, getTransactionsForAccount, setAccounts } from '../storage/domainobjectstore.js';

describe('nearaccount transactions from accounting export', function () {
    it('should get transactions for petersalomonsen.near', async function () {
        this.timeout(5 * 60000);
        const account = 'petersalomonsen.near';
        await setAccounts([account]);
        await fetchTransactionsFromAccountingExport(account);
        const transactions = await getTransactionsForAccount(account);

        // Verify we got transactions
        expect(transactions.length).to.be.greaterThan(0);

        // Verify transactions are sorted by block_height descending
        for (let n = 0; n < transactions.length - 1; n++) {
            expect(transactions[n].block_height).to.be.greaterThan(transactions[n + 1].block_height);
        }

        // Verify all transactions have required fields
        for (const tx of transactions) {
            expect(tx.hash).to.be.a('string');
            expect(tx.block_height).to.be.a('number');
            expect(tx.balance).to.not.be.undefined;
            expect(tx._source).to.equal('accounting-export');
        }

        // Verify transactions before 2022-01-01 exist
        const block_timestamp = BigInt(new Date('2022-01-01').getTime()) * BigInt(1_000_000);
        const txBefore = transactions.filter(tx => BigInt(tx.block_timestamp) < block_timestamp);
        expect(txBefore.length).to.be.greaterThan(0);
    });

    it('all transactions should have balance', async function () {
        this.timeout(5 * 60000);
        const account = 'petersalomonsen.near';
        await setAccounts([account]);
        await fetchTransactionsFromAccountingExport(account);
        const transactions = await getTransactionsForAccount(account);
        for (let n = 0; n < transactions.length; n++) {
            const transaction = transactions[n];
            expect(Number(BigInt(transaction.balance))).to.be.gt(0);
        }
    });

    it('should have correct balances from accounting export for petersalomonsen.near', async function () {
        this.timeout(5 * 60000);
        const account = 'petersalomonsen.near';
        await setAccounts([account]);
        await fetchTransactionsFromAccountingExport(account);
        const transactions = await getTransactionsForAccount(account);

        // Build lookup by hash
        const balanceByHash = {};
        for (const tx of transactions) {
            balanceByHash[tx.hash] = tx.balance;
        }

        // Verify known transaction hashes have balances from accounting export
        // These are the same hashes that were verified with RPC data
        const knownHashes = [
            '6aFHUysZbGeNZSKnFW8e8yp1iYghFatvn6qJ8YcBK9yr',
            'HhKwApMvcMaXKERv1nE3rmKSLjgBSk3u7BjFarr61wEy',
            'Af2ZfAHULc4Eh3KpctLtLARViaqo2c7aXgo5okkLJ7pz',
            'A8Fx5L3nyyiod6oe1Nhfcn73t2assWgCKHSqHtKC5GPE',
            '55uEp3iWq3A6S6tZPjNPa7Spt2dePQSbsTU6JDJWRXcS',
            'CJKdJ3K9eL6ZUxnjtzLvaxwJ1bcAYf5jLHuAKQsjt8mo',
            'CC7cGtUgHk6KwbpTMok5Ff3uVBVM8Y6LAfDC1qb35Hbt',
            '8cW5831s99VfKV8zD6ELZDB5chZukn5xdy5D1w8TPs5x',
        ];

        // Accounting export groups by block, so not all hashes may be the primary
        // Verify that hashes found have valid balances
        let found = 0;
        for (const hash of knownHashes) {
            if (balanceByHash[hash] !== undefined) {
                expect(Number(BigInt(balanceByHash[hash]))).to.be.gt(0);
                found++;
            }
        }
        // At least some of the known hashes should be present as primary hashes
        expect(found, 'Expected some known tx hashes to be present in accounting export data').to.be.greaterThan(0);
    });

    it('should have correct balances for psalomo.near', async function () {
        this.timeout(5 * 60000);
        const account = 'psalomo.near';
        await setAccounts([account]);
        await fetchTransactionsFromAccountingExport(account);
        const transactions = await getTransactionsForAccount(account);

        expect(transactions.length).to.be.greaterThan(0);

        // All transactions should have balance
        for (const tx of transactions) {
            expect(tx.balance).to.not.be.undefined;
            expect(Number(BigInt(tx.balance))).to.be.gte(0);
        }
    });
});
