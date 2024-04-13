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
                const existingTransaction = transactions.find(t => t.transaction_hash === historyLine.transaction_hash
                    && t.ft.symbol === historyLine.ft.symbol
                    && t.delta_amount === historyLine.delta_amount);

                if (!existingTransaction) {
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

    const balancePerSymbol = {};
    for (let n = transactions.length - 1; n >= 0; n--) {
        const transaction = transactions[n];
        if (balancePerSymbol[transaction.ft.symbol] === undefined) {
            balancePerSymbol[transaction.ft.symbol] = 0n;
        }
        balancePerSymbol[transaction.ft.symbol] += BigInt(transaction.delta_amount);
        transaction.balance = balancePerSymbol[transaction.ft.symbol].toString();
    }
    return transactions;
}