const transactionCache = {};

export async function getAndCacheTransactions(accountId, transactionHash, blockHeight) {
    const transaction = transactionCache[transactionHash];
    if(transaction) {
        return transaction;
    } else {
        await getAccountTransactionsData(accountId, blockHeight);
        return transactionCache[transactionHash];
    }
}

export async function getAccountTransactionsData(accountId, maxBlockHeight = null) {
    const url = 'https://explorer.main.fastnear.com/v0/account';
    const body = { account_id: accountId };
    if (maxBlockHeight) {
        body.max_block_height = maxBlockHeight;
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        throw new Error(`Error fetching account transactions: ${response.statusText}`);
    }
    const data = await response.json();
    data.transactions.forEach(tx => {
        transactionCache[tx.execution_outcome.id] = tx;
    });
    return data;
}

export async function getAccountTransactionsMetaData(accountId, maxBlockHeight = null) {    
    const data = await getAccountTransactionsData(accountId, maxBlockHeight);
    return data.account_txs.map(tx => ({
        hash: tx.transaction_hash,
        block_height: tx.tx_block_height,
        block_timestamp: tx.tx_block_timestamp,
        signer_id: tx.signer_id,
        account_id: tx.account_id,
        args: {
            
        }
    }));
}

