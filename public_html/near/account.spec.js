import { getNearblocksAccountHistory, getPikespeakaiAccountHistory, getTransactionsToDate, setTransactionDataApi } from './account.js';
import { getTransactionsForAccount, fetchTransactionsForAccount } from '../storage/domainobjectstore.js';
import { getTransactionDataApi } from './account.js';
import { TRANSACTION_DATA_API_NEARBLOCKS, TRANSACTION_DATA_API_PIKESPEAKAI } from './account.js';

describe('nearaccount transactions petersalomonsen.near', function () {
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

    it.skip('should get transactions using the pikespeak.ai API, and then add new transactions on the next date', async function () {
        this.timeout(5 * 60000);
        setTransactionDataApi(TRANSACTION_DATA_API_PIKESPEAKAI);

        let transactions = [];

        let block_timestamp = BigInt(new Date('2021-05-24').getTime()) * BigInt(1_000_000);
        const startPage = 80;
        const referenceTransactions = [];
        let page = startPage;
        while (true) {
            const refTransactionsPage = await getPikespeakaiAccountHistory(account, 25, page);
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

    it('all transactions should have balance', async function () {
        await fetchTransactionsForAccount(account, 1626977729473574682);
        const transactions = await getTransactionsForAccount(account);
        for (let n = 0; n < transactions.length; n++) {
            const transaction = transactions[n];
            expect(Number(BigInt(transaction.balance))).to.be.gt(0);
        }

    });
});
