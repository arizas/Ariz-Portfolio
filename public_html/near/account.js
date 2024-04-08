import { setProgressbarValue } from '../ui/progress-bar.js';
import { getArchiveNodeUrl, getHelperNodeUrl } from './network.js';
import { retry } from './retry.js';

export async function getAccountChanges(block_id, account_ids) {
    return (await fetch(getArchiveNodeUrl(), {
        method: 'POST',
        headers: {
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            "jsonrpc": "2.0",
            "id": "dontcare",
            "method": "EXPERIMENTAL_changes",
            "params": {
                "changes_type": "account_changes",
                "account_ids": account_ids,
                "block_id": block_id === 'final' ? undefined : block_id,
                "finality": block_id === 'final' ? block_id : undefined
            }
        }
        )
    }).then(r => r.json())).result;
}

export async function viewAccount(block_id, account_id) {
    return (await fetch(getArchiveNodeUrl(), {
        method: 'POST',
        headers: {
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            "jsonrpc": "2.0",
            "id": "dontcare",
            "method": "query",
            "params": {
                "request_type": "view_account",
                "account_id": account_id,
                "block_id": block_id === 'final' ? undefined : block_id,
                "finality": block_id === 'final' ? block_id : undefined
            }
        }
        )
    }).then(r => r.json())).result;
}

export async function getNearblocksAccountHistory(account_id, maxentries = 25, page = 1) {
    const url = `https://api.nearblocks.io/v1/account/${account_id}/txns?page=${page}&per_page=${maxentries}&order=desc`;
    for (let n = 0; n < 5; n++) {
        try {
            const result = (await fetch(url, {
                mode: 'cors'
            }).then(r => r.json())).txns.map(tx => (
                {
                    "block_hash": tx.included_in_block_hash,
                    "block_timestamp": tx.block_timestamp,
                    "hash": tx.transaction_hash,
                    "signer_id": tx.predecessor_account_id,
                    "receiver_id": tx.receiver_account_id,
                    "action_kind": tx.actions? tx.actions[0].action : null,
                    "args": {
                        "method_name": tx.actions? tx.actions[0].method : null
                    }
                }
            ));
            return result;
        } catch (e) {
            console.error('error', e, 'retry in 30 seconds', (n + 1));
            await new Promise(resolve => setTimeout(() => resolve(), 30_000));
        }
    }
}

export async function getTransactionsToDate(account, offset_timestamp, transactions = [], CHUNK_SIZE = 25, startPage = 1) {
    CHUNK_SIZE = 25;
    let page = startPage;
    let accountHistory = await getNearblocksAccountHistory(account, CHUNK_SIZE, page);
    let insertIndex = 0;

    while (true) {
        let newTransactionsAdded = 0;
        let transactionsSkipped = 0;
        for (let n = 0; n < accountHistory.length; n++) {
            const historyLine = accountHistory[n];
            if (BigInt(historyLine.block_timestamp) > BigInt(offset_timestamp)) {
                transactionsSkipped++;
            } else {
                const existingTransaction = transactions.find(t => t.hash == historyLine.hash);
                if (!existingTransaction) {
                    historyLine.balance = await retry(() => getAccountBalanceAfterTransaction(account, historyLine.hash));
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
        accountHistory = await getNearblocksAccountHistory(account, CHUNK_SIZE, page);
    }
    return transactions;
}

export async function getTransactionStatus(txhash, account_id) {
    return (await fetch(getArchiveNodeUrl(), {
        method: 'POST',
        headers: {
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            "jsonrpc": "2.0",
            "id": "dontcare",
            "method": "tx",
            "params": [txhash, account_id]
        }
        )
    }).then(r => r.json())).result;
}

export async function getAccountBalanceAfterTransaction(account_id, txhash) {
    const executionBlockIds = (await getTransactionStatus(txhash, account_id)).receipts_outcome.map(outcome => outcome.block_hash);
    const executionBlocksAccountStatus = await Promise.all(executionBlockIds.map(block_hash => viewAccount(block_hash, account_id)));
    executionBlocksAccountStatus.sort((a, b) => b.block_height - a.block_height);
    return executionBlocksAccountStatus[0].amount;
}