import { setProgressbarValue } from '../ui/progress-bar.js';
import { getFromNearBlocks } from './nearblocks.js';
import { getArchiveNodeUrl } from './network.js';
import { retry } from './retry.js';
import { getBlockInfo } from './stakingpool.js';

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
    const path = `/v1/account/${account_id}/txns?page=${page}&per_page=${maxentries}&order=desc`;

    const result = await getFromNearBlocks(path);

    const mappedResult = result.txns.map(tx => (
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
    return mappedResult;
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

    while (accountHistory.length > 0) {
        let newTransactionsAdded = 0;
        let transactionsSkipped = 0;

        for (let n = 0; n < accountHistory.length; n++) {
            const historyLine = accountHistory[n];
            if (BigInt(historyLine.block_timestamp) > BigInt(offset_timestamp)) {
                transactionsSkipped++;
            } else {
                const existingTransaction = transactions.find(t => t.hash == historyLine.hash);
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
        accountHistory = await getAccountHistory(page);
    }

    await fixTransactionsWithoutBalance({ account, transactions });
    return transactions;
}

export async function fixTransactionsWithoutBalance({ account, transactions }) {
    const transactionsWithoutBalance = transactions.filter(txn => txn.balance === undefined);
    let n = 0;
    for (const transaction of transactionsWithoutBalance) {
        const { stopButtonClicked } = setProgressbarValue(n / transactionsWithoutBalance.length, `${account} ${new Date(transaction.block_timestamp / 1_000_000).toDateString()}`, true);

        if (stopButtonClicked) {
            break;
        }

        if (!transaction.block_height) {
            const blockInfo = await getBlockInfo(transaction.block_hash);
            transaction.block_height = blockInfo.header.height;
        }
        const { balance, transaction: transactionFromBlock } = await retry(() => getAccountBalanceAfterTransaction(account, transaction.hash, transaction.block_height));
        transaction.balance = balance;
        transaction.signer_id = transactionFromBlock.transaction.signer_id;
        transaction.receiver_id = transactionFromBlock.transaction.receiver_id;
        const transactionActions = transactionFromBlock.transaction.actions;
        if (transactionActions && transactionActions.length > 0) {
            const actionKind = Object.keys(transactionFromBlock.transaction.actions[0])[0];
            transaction.action_kind = (() => {
                switch (actionKind) {
                    case 'FunctionCall':
                        return 'FUNCTION_CALL';
                    default:
                        return actionKind;
                }
            })();
            transaction.args.method_name = transactionFromBlock.transaction.actions[0].FunctionCall?.method_name;
        } else {
            transaction.action_kind = null;
            transaction.args.method_name = null;
        }
        n++;
    }
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
    const txStatus = await getTransactionStatus(tx_hash, account_id);
    const block_hash = txStatus.receipts_outcome[txStatus.receipts_outcome.length-1].block_hash;
    const blockdata = await getBlockInfo(block_hash);
    console.log(blockdata);
    const accountStatus = await viewAccount(block_hash, account_id);

    return { transaction: txStatus, balance: accountStatus.amount, blockdata };
}