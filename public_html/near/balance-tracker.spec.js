// Chai is provided globally by the test runner
const { expect } = window;
import {
    getAccountBalanceAtBlock,
    getAllBalances,
    detectBalanceChanges,
    discoverValuableTokens,
    findTransactionDates,
    getBlockHeightAtDate,
    findTransactionBlocks
} from './balance-tracker.js';
import { fetchTransactionsUsingBalanceTracker } from '../storage/domainobjectstore.js';

describe('Balance Tracker', () => {
    // Set test RPC endpoint if available
    before(() => {
        // The test runner should set this from the .env file
        window.TEST_RPC_ENDPOINT = 'https://archival-rpc.mainnet.fastnear.com';
    });

    // Test with a known account that should have balance
    const TEST_ACCOUNT = 'webassemblymusic-treasury.sputnik-dao.near';

    it('should fetch transactions for one day using balance tracker', async function() {
        this.timeout(30000); // 30 second timeout for RPC calls

        const accountId = TEST_ACCOUNT;
        const today = new Date("2025-09-22T00:00:00.000Z");
        const yesterday = new Date("2025-09-21T00:00:00.000Z");

        console.log(`Testing fetchTransactionsUsingBalanceTracker for ${accountId}`);
        console.log(`Date range: ${yesterday.toISOString()} to ${today.toISOString()}`);

        // Fetch transactions for the last day
        const transactions = await fetchTransactionsUsingBalanceTracker(accountId, yesterday, today);

        console.log(`Found ${transactions.length} transactions in the last day`);

        // Verify the result is an array
        expect(transactions).to.be.an('array');

        // Log some details if transactions were found
        if (transactions.length > 0) {
            console.log('First transaction:', {
                date: new Date(parseInt(transactions[0].block_timestamp) / 1_000_000),
                hash: transactions[0].hash,
                signer: transactions[0].signer_id,
                receiver: transactions[0].receiver_id
            });

            console.log('Last transaction:', {
                date: new Date(parseInt(transactions[transactions.length - 1].block_timestamp) / 1_000_000),
                hash: transactions[transactions.length - 1].hash,
                signer: transactions[transactions.length - 1].signer_id,
                receiver: transactions[transactions.length - 1].receiver_id
            });
        }

        // Return the transactions for inspection
        return transactions;
    });
});