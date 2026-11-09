// What the Accounts page's buttons do, as functions: the page calls them, and so
// does the AI assistant once the user has approved, so the two cannot drift.

import { fetchTransactionsFromAccountingExport, writeConfidentialIntentsHistory, reconcileStoredConfidentialBalances } from '../storage/domainobjectstore.js';
import { refreshStoredPriceHistories } from '../pricedata/pricedata.js';
import { openConfidentialSession, fetchConfidentialHistory, fetchConfidentialBalances } from '../near/intentshistory.js';

/**
 * Each account's transaction history from the gateway's accounting export,
 * merged into the store, then the stored price histories brought up to date:
 * after the transactions, so prices are as current as what they value.
 */
export async function fetchAccountsFromExport(accounts, { onProgress = () => { }, onPriceProgress = () => { } } = {}) {
    const fetched = [];
    for (const account of accounts) {
        onProgress(`Downloading transaction history for ${account} from server...`);
        const result = await fetchTransactionsFromAccountingExport(account, { merge: true });
        fetched.push({
            account,
            newTransactions: result.newTransactionsCount,
            newTokenTransactions: result.newFtTransactionsCount,
            stakingPools: result.stakingPools?.length || 0,
        });
    }
    const prices = await refreshStoredPriceHistories(onPriceProgress);
    return { fetched, pricesUpdated: prices.updated, pricesFailed: prices.failed };
}

/**
 * The confidential intents history of one account, which only that account can
 * read, so its wallet signs: then stored, and checked against the balances the
 * intents API reports, because a truncated fetch still adds up.
 */
export async function fetchConfidentialForAccount(account, { onProgress = () => { } } = {}) {
    onProgress(`Sign the message as ${account} to read its confidential history…`);
    const session = await openConfidentialSession(account);
    onProgress(`Fetching confidential intents history for ${account}…`);
    const items = await fetchConfidentialHistory(session);
    const { total, added, updated } = await writeConfidentialIntentsHistory(account, items);
    onProgress('Reconciling against the confidential ledger…');
    const mismatches = await reconcileStoredConfidentialBalances(account, await fetchConfidentialBalances(session));
    return { fetched: items.length, total, added, updated, mismatches };
}
