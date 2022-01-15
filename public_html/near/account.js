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

export async function getHelperAccountHistory(account_id, maxentries = 100, offset_timestamp = new Date().getTime() * 1_000_000) {
    return await fetch(`${getHelperNodeUrl()}/account/${account_id}/activity?offset=${offset_timestamp}&limit=${maxentries}`).then(r => r.json());
}


export async function getTransactionsToDate(account, offset_timestamp, transactions = [], CHUNK_SIZE = 100) {
    let accountHistory = await getHelperAccountHistory(account, CHUNK_SIZE, offset_timestamp);
    let insertIndex = 0;

    while (true) {
        let newTransactionsAdded = 0;
        for (let n = 0; n < accountHistory.length; n++) {
            const historyLine = accountHistory[n];
            if (!transactions.find(t => t.hash == historyLine.hash && t.action_index == historyLine.action_index
                && historyLine.block_hash == t.block_hash && t.action_kind == historyLine.action_kind
                && t.signer_id == historyLine.signer_id)) {
                historyLine.balance = await retry(() => getAccountBalanceAfterTransaction(account, historyLine.hash));

                transactions.splice(insertIndex++, 0, historyLine);
                offset_timestamp = parseInt(historyLine.block_timestamp) + 1;
                newTransactionsAdded++;
            }
            setProgressbarValue(n / accountHistory.length, `${account} ${new Date(historyLine.block_timestamp / 1_000_000).toDateString()}`)
        }
        if (newTransactionsAdded == 0) {
            break;
        }
        accountHistory = await getHelperAccountHistory(account, CHUNK_SIZE, offset_timestamp);
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