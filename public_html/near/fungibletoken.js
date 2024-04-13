import { setProgressbarValue } from '../ui/progress-bar.js';

export async function fetchFungibleTokenHistory(account_id, maxentries = 25, page = 1) {
    const url = `https://api.nearblocks.io/v1/account/petersalomonsen.near/ft-txns?page=${page}&per_page=${maxentries}&order=desc`;
    const result = await fetch(url).then(r => r.json());
    return result.txns;
}

export async function getFungibleTokenTransactionsToDate(account, offset_timestamp, transactions = [], startPage = 1) {
    const CHUNK_SIZE = 25;
    let page = startPage;
    let accountHistory = await fetchFungibleTokenHistory(account, CHUNK_SIZE, page);
    let insertIndex = 0;

    while (true) {
        let newTransactionsAdded = 0;
        let transactionsSkipped = 0;
        for (let n = 0; n < accountHistory.length; n++) {
            const historyLine = accountHistory[n];
            if (BigInt(historyLine.block_timestamp) > BigInt(offset_timestamp)) {
                transactionsSkipped++;
            } else {
                const existingTransaction = transactions.find(t => t.transaction_hash == historyLine.transaction_hash);
                if (!existingTransaction) {
                    //historyLine.balance = await retry(() => getAccountBalanceAfterTransaction(account, historyLine.transaction_hash));
                    transactions.splice(insertIndex++, 0, historyLine);
                    offset_timestamp = BigInt(historyLine.block_timestamp) + 1n;
                    newTransactionsAdded++;
                }
            }
            setProgressbarValue(n / accountHistory.length, `${account} ${new Date(historyLine.block_timestamp / 1_000_000).toDateString()}`)
        }
        if (transactionsSkipped == 0 && newTransactionsAdded == 0) {
            break;
        }
        page++;
        accountHistory = await fetchFungibleTokenHistory(account, CHUNK_SIZE, page);
    }
    return transactions;
}