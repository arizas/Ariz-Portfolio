import { setProgressbarValue } from '../ui/progress-bar.js';
import { getArchiveNodeUrl } from './network.js';
import { retry } from './retry.js';

const PIKESPEAKAI_API_LOCALSTORAGE_KEY = 'pikespeakai_api_key';
const TRANSACTION_DATA_API_LOCALSTORAGE_KEY = 'near_transactiondata_api';
export const TRANSACTION_DATA_API_NEARBLOCKS = 'nearblocks';
export const TRANSACTION_DATA_API_PIKESPEAKAI = 'pikespeakai';

export function getTransactionDataApi() {
    const transactionDataApi = localStorage.getItem(TRANSACTION_DATA_API_LOCALSTORAGE_KEY);
    if (transactionDataApi == null) {
        return TRANSACTION_DATA_API_NEARBLOCKS;
    } else {
        return transactionDataApi;
    }
}

export function setTransactionDataApi(api_name) {
    localStorage.setItem(TRANSACTION_DATA_API_LOCALSTORAGE_KEY, api_name);
}

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

export async function getPikespeakaiAccountHistory(account_id, maxentries = 50, page = 1) {
    const url = `https://api.pikespeak.ai/account/transactions/${account_id}?limit=${maxentries}&offset=${(page - 1) * maxentries}`;
    for (let n = 0; n < 5; n++) {
        try {
            const result = (await fetch(url, {
                mode: 'cors',
                headers: {
                    'x-api-key': localStorage.getItem(PIKESPEAKAI_API_LOCALSTORAGE_KEY)
                }
            }).then(r => r.json())).map(tx => (
                {
                    "block_hash": tx.block_hash,
                    "block_timestamp": tx.transaction_timestamp,
                    "hash": tx.id,
                    "signer_id": tx.signer,
                    "receiver_id": tx.receiver,
                    "action_kind": tx.first_action_type
                }
            ));
            await new Promise(resolve => setTimeout(() => resolve(), 500));
            return result;
        } catch (e) {
            console.error('error', e, 'retry in 30 seconds', (n + 1));
            await new Promise(resolve => setTimeout(() => resolve(), 30_000));
        }
    }
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
                    "block_height": tx.block.block_height,
                    "block_timestamp": tx.block_timestamp,
                    "hash": tx.transaction_hash,
                    "signer_id": tx.predecessor_account_id,
                    "receiver_id": tx.receiver_account_id,
                    "action_kind": tx.actions ? tx.actions[0].action : null,
                    "args": {
                        "method_name": tx.actions ? tx.actions[0].method : null
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

    const getAccountHistory = async (page) => {
        switch (getTransactionDataApi()) {
            case TRANSACTION_DATA_API_NEARBLOCKS:
                return await getNearblocksAccountHistory(account, CHUNK_SIZE, page);
                break;
            case TRANSACTION_DATA_API_PIKESPEAKAI:
                return await getPikespeakaiAccountHistory(account, CHUNK_SIZE, page);
                break;
        }
    };
    let accountHistory = await getAccountHistory(page);
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
                    historyLine.balance = await retry(() => getAccountBalanceAfterTransaction(account, historyLine.hash, historyLine.block_height));
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
        accountHistory = await getAccountHistory(page);
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

export async function getAccountBalanceAfterTransaction(account_id, tx_hash, block_height) {
    let block_height_bn = BigInt(block_height);

    let blockdata = await fetch(`https://mainnet.neardata.xyz/v0/block/${block_height_bn.toString()}`).then(r => r.json());
    let transactionInFirstBlock;
    let balance;

    blockdata.shards.forEach(shard => {
        const transaction = shard.chunk.transactions.find(transaction => transaction.transaction.hash === tx_hash);
        if (transaction) {
            transactionInFirstBlock = transaction;
        }

        const account_update = shard.state_changes.find(state_change =>
            state_change.type === 'account_update' &&
            state_change.cause.type === 'transaction_processing' &&
            state_change.cause.tx_hash === tx_hash &&
            state_change.change.account_id === account_id
        );
        if (account_update) {
            balance = account_update.change.amount;
        }
    });

    let receipt_ids = transactionInFirstBlock.outcome.execution_outcome.outcome.receipt_ids;
    
    while (receipt_ids.length > 0) {
        receipt_ids.forEach(receipt_id => {
            blockdata.shards.forEach(shard => {
                const receipt_execution_outcome = shard.receipt_execution_outcomes.find(receipt_execution_outcome => receipt_execution_outcome.execution_outcome.id === receipt_id);
                const account_update = shard.state_changes.find(state_change =>
                    state_change.type === 'account_update' &&
                    state_change.cause.type === 'receipt_processing' &&
                    receipt_ids.includes(state_change.cause.receipt_hash) &&
                    state_change.change.account_id === account_id
                );

                if (account_update) {
                    balance = account_update.change.amount;
                }

                if (receipt_execution_outcome) {
                    receipt_ids = receipt_ids.filter(id => id !== receipt_id).concat(receipt_execution_outcome.execution_outcome.outcome.receipt_ids);
                }
            });
        });
        if (receipt_ids.length > 0) {
            block_height_bn += 1n;
            blockdata = await fetch(`https://mainnet.neardata.xyz/v0/block/${block_height_bn.toString()}`).then(r => r.json());
        }
    }
    return balance;
}