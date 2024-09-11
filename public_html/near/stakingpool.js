import { getTransactionsForAccount } from '../storage/domainobjectstore.js';
import { setProgressbarValue } from '../ui/progress-bar.js';
import { retry } from './retry.js';
import { queryMultipleRPC } from './rpc.js';

export async function getBlockInfo(block_id) {
    const getBlockInfoQuery = async (rpcUrl) =>
        await fetch(rpcUrl, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                "jsonrpc": "2.0",
                "id": "dontcare",
                "method": "block",
                "params": {
                    "block_id": block_id === 'final' ? undefined : block_id,
                    "finality": block_id === 'final' ? block_id : undefined
                }
            }
            )
        });
    return (await queryMultipleRPC(getBlockInfoQuery)).result;
}

export async function getBlockData(block_height) {
    let blockEndpoint = 'block';
    if (block_height === 'final') {
        blockEndpoint = 'last_block';
    }
    return (await fetch(`https://mainnet.neardata.xyz/v0/${blockEndpoint}/${block_height}`).then(r => r.json())).block;
}

let rpcIndex = 0;

export async function getAccountBalanceInPool(stakingpool_id, account_id, block_id) {
    const accountBalanceQuery = async (rpcUrl) => {
        const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                'jsonrpc': '2.0',
                'id': 'dontcare',
                'method': 'query',
                'params': {
                    request_type: 'call_function',
                    block_id: block_id,
                    account_id: stakingpool_id,
                    method_name: 'get_account_total_balance',
                    args_base64: btoa(JSON.stringify({
                        account_id: account_id
                    }))
                }
            })
        });
        return response;
    };

    const resultObj = await queryMultipleRPC(accountBalanceQuery);
    if (resultObj && !resultObj.error) {
        return parseInt(resultObj.result.result.map(c => String.fromCharCode(c)).join('').replace(/\"/g, ''));
    } else {
        console.log('error getting staking account balance', stakingpool_id, account_id, block_id, resultObj);
        return null;
    }

}

export async function getStakingAccounts(account) {
    const transactions = await getTransactionsForAccount(account);
    const stakingTransactions = transactions.filter(t => t.action_kind === 'FUNCTION_CALL' && t.args.method_name === 'deposit_and_stake');

    const stakingAccounts = [];
    stakingTransactions.forEach(t => {
        if (!stakingAccounts.find(a => a == t.receiver_id)) {
            stakingAccounts.push(t.receiver_id);
        }
    });
    return stakingAccounts;
}

export async function fetchEarlierStakingEarnings() {
    const stakingTransactions = (await getTransactionsForAccount(account_id)).filter(t => t.receiver_id === stakingpool_id);

    const firstStakingTransactionTimeStamp = stakingTransactions[stakingTransactions.length - 1].block_timestamp;
    console.log(stakingpool_id, account_id, new Date(firstStakingTransactionTimeStamp / 1_000_000));
}

export async function fetchAllStakingEarnings(stakingpool_id, account_id, stakingBalanceEntries, maxStartBlock = 'final') {
    let block = await getBlockData(maxStartBlock);

    const stakingTransactions = (await getTransactionsForAccount(account_id))
        .filter(t => (t.receiver_id === stakingpool_id || t.signer_id === stakingpool_id)
            && t.block_timestamp < block.header.timestamp);

    const firstStakingTransaction = stakingTransactions[stakingTransactions.length - 1];
    const firstStakingTransactionTimeStamp = parseInt(firstStakingTransaction.block_timestamp);

    const maxBlockTimeStamp = block.header.timestamp;

    let latestBalance = await getAccountBalanceInPool(stakingpool_id, account_id, block.header.height);
    if (latestBalance == 0) {
        if (stakingTransactions[0].block_height) {
            block = await getBlockData(stakingTransactions[0].block_height);
        } else {
            block = await getBlockInfo(stakingTransactions[0].block_hash);
        }
        latestBalance = await getAccountBalanceInPool(stakingpool_id, account_id, block.header.height);
    }
    let currentlatestEpochId = stakingBalanceEntries.length > 0 ? stakingBalanceEntries[0].epoch_id : null;

    let insertIndex = 0;

    while (true) {
        setProgressbarValue(1 - ((block.header.timestamp - firstStakingTransactionTimeStamp) / (maxBlockTimeStamp - firstStakingTransactionTimeStamp)),
            `${account_id} / ${stakingpool_id} ${new Date(block.header.timestamp / 1_000_000).toDateString()}`)

        if (block.header.epoch_id == currentlatestEpochId ||
            block.header.timestamp < firstStakingTransactionTimeStamp) {
            break;
        }

        if (latestBalance !== null) {
            const stakingBalanceEntry = {
                timestamp: new Date(block.header.timestamp / 1_000_000),
                balance: latestBalance,
                block_height: block.header.height,
                epoch_id: block.header.epoch_id,
                next_epoch_id: block.header.next_epoch_id,
                deposit: 0,
                withdrawal: 0
            };

            stakingBalanceEntries.splice(insertIndex++, 0, stakingBalanceEntry);
        }

        let next_epoch_id = block.header.next_epoch_id;
        let existingStakingBalanceEntryForNextEpoch = stakingBalanceEntries.find(sbe => block.header.next_epoch_id === sbe.next_epoch_id);

        while (existingStakingBalanceEntryForNextEpoch) {
            next_epoch_id = existingStakingBalanceEntryForNextEpoch.epoch_id;
            existingStakingBalanceEntryForNextEpoch = stakingBalanceEntries.find(sbe => existingStakingBalanceEntryForNextEpoch.epoch_id === sbe.next_epoch_id);
        }
        block = await retry(() => getBlockInfo(next_epoch_id));
        latestBalance = await retry(() => getAccountBalanceInPool(stakingpool_id, account_id, block.header.height));
    }

    for (let stakingTransaction of stakingTransactions) {
        if (!stakingBalanceEntries.find(sbe => sbe.hash === stakingTransaction.hash)) {
            if (stakingTransaction.block_height) {
                block = await retry(() => getBlockData(stakingTransaction.block_height));
            } else {
                block = await retry(() => getBlockInfo(stakingTransaction.block_hash));
            }
            const stakingBalance = await retry(() => getAccountBalanceInPool(stakingpool_id, account_id, block.header.height), 1);
            const timestamp = new Date(stakingTransaction.block_timestamp / 1_000_000);
            if (stakingBalance !== null) {
                stakingBalanceEntries.push({
                    timestamp,
                    balance: stakingBalance,
                    hash: stakingTransaction.hash,
                    block_height: block.header.height,
                    epoch_id: block.header.epoch_id,
                    next_epoch_id: block.header.next_epoch_id,
                    deposit: stakingTransaction.signer_id == account_id ? parseInt(stakingTransaction.args.deposit) : 0,
                    withdrawal: stakingTransaction.signer_id == stakingpool_id ? parseInt(stakingTransaction.args.deposit) : 0
                });
            } else {
                console.log('no staking balance', timestamp, stakingBalance, stakingpool_id, account_id, stakingTransaction.block_hash)
            }
        }
    }

    stakingBalanceEntries.sort((a, b) => b.block_height - a.block_height);
    for (let n = 0; n < stakingBalanceEntries.length - 1; n++) {
        const stakingBalanceEntry = stakingBalanceEntries[n];
        if (!stakingBalanceEntry.deposit) {
            stakingBalanceEntry.deposit = 0;
        }
        if (!stakingBalanceEntry.withdrawal) {
            stakingBalanceEntry.withdrawal = 0;
        }
        stakingBalanceEntry.earnings = stakingBalanceEntry.balance - stakingBalanceEntries[n + 1].balance -
            stakingBalanceEntry.deposit + stakingBalanceEntry.withdrawal;
    }
    stakingBalanceEntries[stakingBalanceEntries.length - 1].earnings = 0;
    return stakingBalanceEntries;
}

export function findStakingPoolsInTransactions(transactions) {
    return [...new Set(transactions.filter(tx => tx.action_kind === 'FUNCTION_CALL' && tx.args.method_name === 'deposit_and_stake').map(tx => tx.receiver_id))];
}