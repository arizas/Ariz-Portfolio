import { fetchFungibleTokenHistory, getFungibleTokenTransactionsToDate } from "./fungibletoken.js";

describe('fungibletoken transactions petersalomonsen.near', function () {
    const account = 'petersalomonsen.near';

    it('should get transactions, and then add new transactions on the next date', async function () {
        let transactions = [];

        let block_timestamp = BigInt(new Date('2024-03-01').getTime()) * BigInt(1_000_000);
        const startPage = 1;
        const referenceTransactions = [];
        let page = startPage;
        while (true) {
            const refTransactionsPage = await fetchFungibleTokenHistory(account, 25, page);
            refTransactionsPage.forEach(tx => {
                if (!referenceTransactions.find(reftx => reftx.transaction_hash === tx.transaction_hash)) {
                    referenceTransactions.push(tx)
                }
            });
            page++;
            if (refTransactionsPage.length == 0) {
                break;
            }
        }

        transactions = await getFungibleTokenTransactionsToDate(account, block_timestamp, transactions, startPage);

        let referenceTransactionsBeforeBlockTimestamp = referenceTransactions.filter(tx => BigInt(tx.block_timestamp) < block_timestamp);
        console.log(referenceTransactionsBeforeBlockTimestamp.length, transactions.length);
        expect(transactions.length).to.equal(referenceTransactionsBeforeBlockTimestamp.length);

        console.log('adding transactions later');
        block_timestamp = BigInt(new Date('2024-04-12').getTime()) * BigInt(1_000_000);
        referenceTransactionsBeforeBlockTimestamp = referenceTransactions.filter(tx => BigInt(tx.block_timestamp) < block_timestamp);

        transactions = await getFungibleTokenTransactionsToDate(account, block_timestamp, transactions, startPage);
        expect(referenceTransactionsBeforeBlockTimestamp.length).to.equal(transactions.length);

        for (let n = 0; n < referenceTransactionsBeforeBlockTimestamp.length; n++) {
            expect(transactions[n].transaction_hash).to.equal(referenceTransactionsBeforeBlockTimestamp[n].transaction_hash);
        }
        expect(transactions.length).to.equal(referenceTransactionsBeforeBlockTimestamp.length);
    });
});
