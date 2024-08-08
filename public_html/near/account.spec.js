import { TRANSACTION_DATA_API_PIKESPEAKAI, getAccountBalanceAfterTransaction, getNearblocksAccountHistory, getPikespeakaiAccountHistory, getTransactionsToDate, setTransactionDataApi } from './account.js';
import { getTransactionsForAccount, fetchTransactionsForAccount } from '../storage/domainobjectstore.js';

describe('nearaccount transactions petersalomonsen.near', function () {
    const account = 'petersalomonsen.near';
    const getBalanceForTxHash = async (txHash, accountId) => {
        const transaction = await fetch(`https://api3.nearblocks.io/v1/txns/${txHash}`).then(r => r.json());
        const block_height = transaction.txns[0].block.block_height;
        const { balance } = await getAccountBalanceAfterTransaction(accountId, txHash, block_height);
        return balance;
    };

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
        await fetchTransactionsForAccount(account, 1621881780667556458);
        const transactions = await getTransactionsForAccount(account);
        for (let n = 0; n < transactions.length; n++) {
            const transaction = transactions[n];
            expect(Number(BigInt(transaction.balance))).to.be.gt(0);
        }
    });

    it('should get account balance after transaction', async function () {
        this.timeout(1 * 60000);
        expect(await (getBalanceForTxHash('6aFHUysZbGeNZSKnFW8e8yp1iYghFatvn6qJ8YcBK9yr', 'petersalomonsen.near'))).to.equal('386753989351046537832522253');
        expect(await (getBalanceForTxHash('HhKwApMvcMaXKERv1nE3rmKSLjgBSk3u7BjFarr61wEy', 'petersalomonsen.near'))).to.equal('81815522421420461431918066');

        expect(await (getBalanceForTxHash('Af2ZfAHULc4Eh3KpctLtLARViaqo2c7aXgo5okkLJ7pz', 'petersalomonsen.near'))).to.equal('410368406246815598818050335');
        expect(await (getBalanceForTxHash('A8Fx5L3nyyiod6oe1Nhfcn73t2assWgCKHSqHtKC5GPE', 'petersalomonsen.near'))).to.equal('49460915826791408147001516');
        expect(await (getBalanceForTxHash('55uEp3iWq3A6S6tZPjNPa7Spt2dePQSbsTU6JDJWRXcS', 'petersalomonsen.near'))).to.equal('49459906717970905047001516');
        expect(await (getBalanceForTxHash('CJKdJ3K9eL6ZUxnjtzLvaxwJ1bcAYf5jLHuAKQsjt8mo', 'petersalomonsen.near'))).to.equal('49354002147864397747001516');
        expect(await (getBalanceForTxHash('CC7cGtUgHk6KwbpTMok5Ff3uVBVM8Y6LAfDC1qb35Hbt', 'petersalomonsen.near'))).to.equal('466731120151565365929777536');
        expect(await (getBalanceForTxHash('8cW5831s99VfKV8zD6ELZDB5chZukn5xdy5D1w8TPs5x', 'petersalomonsen.near'))).to.equal('201224010096836909761681860');
        expect(await (getBalanceForTxHash('5hcVzM1bR7hLgPBMLD1YAqY6r5Ta7nZheFufuXiKSbWT', 'psalomo.near'))).to.equal('16710096912904207620297833');
    });

    it('should get account balance on the receiving account after failed transaction', async function () {
        expect(await (getBalanceForTxHash('GKJkSWw7HPg5BTEATD9Ys75antWwLnVppPSPzjcBi4mD', 'psalomo.near'))).to.equal('7822086507907767200000000');

    });

    it('should find balance when transaction fails because method is not found on the target contract', async function () {
        expect(await (getBalanceForTxHash('7GRkZ3HNWDUmiFXSVRWt4aEmSt8vJZoJLdXvkkQ1uGn7', 'psalomo.near'))).to.equal('16710096912904207620297833');
        expect(await (getBalanceForTxHash('B4uzghQiEwTCwLLHejaUmMyT9m1jCtTFRVTkZevngrrC', 'psalomo.near'))).to.equal('16710096912904207620297833');
        expect(await (getBalanceForTxHash('2xXghNC1GhjFYokX1nWdWLzMCn7yN3SWyhRowtpGuost', 'psalomo.near'))).to.equal('16710096912904207620297833');
        expect(await (getBalanceForTxHash('GHP8GDYN6gdHqq6ZH7adZUUNbmovjC1i25bxAp6Jvb5W', 'psalomo.near'))).to.equal('16710096912904207620297833');
    });
    it('should find balance for transaction when passed blockheight is not the first block for the transaction', async function() {
        expect((await (getAccountBalanceAfterTransaction('petersalomonsen.near', 'H5TRhv1wZgBtRHrWpkHpcQ3KiBkFC6wfj1Zcq9XDCJ3L', 111132053))).balance).to.equal('65262119033825266605299669');
    });
});
