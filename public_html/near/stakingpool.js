import { getTransactionsForAccount } from '../storage/domainobjectstore.js';
import { setProgressbarValue } from '../ui/progress-bar.js';
import { getAccountBalanceAfterTransaction } from './account.js';
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
        console.error(resultObj.error);
        throw new Error(`Error getting staking account balance for staking pool ${stakingpool_id}, account ${account_id}, block_id ${block_id}. Result: ${JSON.stringify(resultObj?.error)}`);
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
    let block = await getBlockInfo(maxStartBlock);

    const stakingTransactions = (await getTransactionsForAccount(account_id))
        .filter(t => (t.receiver_id === stakingpool_id || t.signer_id === stakingpool_id)
            && t.block_timestamp < block.header.timestamp);

    const firstStakingTransaction = stakingTransactions[stakingTransactions.length - 1];
    const firstStakingTransactionTimeStamp = parseInt(firstStakingTransaction.block_timestamp);

    const maxBlockTimeStamp = block.header.timestamp;

    let latestBalance = await getAccountBalanceInPool(stakingpool_id, account_id, block.header.height);
    console.log(`staking pool ${stakingpool_id} balance for account ${account_id} in block ${block.header.height} is ${latestBalance}`);
    if (latestBalance === 0) {
        console.log(`Looking for block for last staking transaction from date ${new Date(stakingTransactions[0].block_timestamp / 1_000_000)}`);
        block = await getBlockInfo(stakingTransactions[0].block_hash);

        latestBalance = stakingBalanceEntries.find(sbe => sbe.epoch_id === block.header.epoch_id)?.balance;
        if (latestBalance === undefined) {
            latestBalance = await getAccountBalanceInPool(stakingpool_id, account_id, block.header.height);
        }
        console.log(`staking pool ${stakingpool_id} balance for account ${account_id} in block ${block.header.height} (${new Date(block.header.timestamp / 1_000_000)}}) is ${latestBalance}`);
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

        // block.header.next_epoch_id is the same as the id of last block in the previous epoch
        let previousEpochLatestBlockId = block.header.next_epoch_id;
        let previousEpochStakingBalanceEntry = stakingBalanceEntries.find(sbe => block.header.epoch_id === sbe.next_epoch_id);

        while (previousEpochStakingBalanceEntry) {
            previousEpochLatestBlockId = previousEpochStakingBalanceEntry.next_epoch_id;
            previousEpochStakingBalanceEntry = stakingBalanceEntries.find(sbe => previousEpochStakingBalanceEntry.epoch_id === sbe.next_epoch_id);
        }

        block = await retry(() => getBlockInfo(previousEpochLatestBlockId));
        try {
            latestBalance = await retry(() => getAccountBalanceInPool(stakingpool_id, account_id, block.header.height), 0);
        } catch(e) {
            console.warn(`error fetching staking balance ${stakingpool_id} ${account_id} ${block.header.height}. Skipping.`, e);
        }
    }

    for (let stakingTransaction of stakingTransactions) {
        if (!stakingBalanceEntries.find(sbe => sbe.hash === stakingTransaction.hash)) {
            block = await retry(() => getBlockInfo(stakingTransaction.block_hash));
            
            const stakingBalanceBeforeTransaction = await retry(() => getAccountBalanceInPool(stakingpool_id, account_id, block.header.height), 1);
            const { blockdata } = await getAccountBalanceAfterTransaction(account_id, stakingTransaction.hash, block.header.height);

            const stakingBalanceAfterTransaction = await retry(() => getAccountBalanceInPool(stakingpool_id, account_id, blockdata.header.height), 1);

            const timestamp = new Date(stakingTransaction.block_timestamp / 1_000_000);
            let withdrawal = 0;
            if (stakingTransaction.args.method_name === 'withdraw_all') {
                withdrawal = stakingBalanceBeforeTransaction - stakingBalanceAfterTransaction;                
            }
            let deposit = 0;
            if (stakingTransaction.args.method_name === 'deposit_and_stake') {
                deposit = stakingBalanceAfterTransaction - stakingBalanceBeforeTransaction;
            }
            stakingBalanceEntries.push({
                timestamp,
                balance: stakingBalanceAfterTransaction,
                hash: stakingTransaction.hash,
                block_height: block.header.height,
                epoch_id: block.header.epoch_id,
                next_epoch_id: block.header.next_epoch_id,
                deposit,
                withdrawal
            });
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