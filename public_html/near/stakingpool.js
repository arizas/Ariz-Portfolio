import { getTransactionsForAccount } from '../storage/domainobjectstore.js';
import { setProgressbarValue } from '../ui/progress-bar.js';
import { retry } from './retry.js';

const stakingArchiveNodeUrl = 'https://1rpc.io/near';

async function getBlockInfo(block_id) {
    return (await fetch(stakingArchiveNodeUrl, {
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
    }).then(r => r.json())).result;
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
    const accountBalanceQuery = async (rpcUrl) =>
        await fetch(rpcUrl, {
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

    const rpcs = [
        'https://near.lava.build',
        'https://rpc.mainnet.near.org',
        'https://1rpc.io/near',
        'https://archival-rpc.mainnet.near.org'
    ];

    const queryRPC = async (rpcUrl) => {
        const response = await accountBalanceQuery(rpcUrl);
        const resultObj = response.ok ? await response.json() : null;
        if (!resultObj || resultObj.error) {
            return null;
        }
        return resultObj;
    };
    let resultObj;
    for (let n = 0; n < rpcs.length; n++) {
        resultObj = await queryRPC(rpcs[(n + rpcIndex) % rpcs.length]);
        if (resultObj) {
            break;
        }
    }
    rpcIndex++;
    return parseInt(resultObj.result.result.map(c => String.fromCharCode(c)).join('').replace(/\"/g, ''));
}

export async function getStakingAccounts(account) {
    const transactions = await getTransactionsForAccount(account);
    const stakingTransactions = transactions.filter(t => t.action_kind == 'FUNCTION_CALL' && t.args.method_name == 'deposit_and_stake');
    const stakingAccounts = [];
    stakingTransactions.forEach(t => {
        if (!stakingAccounts.find(a => a == t.receiver_id)) {
            stakingAccounts.push(t.receiver_id);
        }
    });
    return stakingAccounts;
}

export async function getStakingEarnings(stakingpool_id, account_id, numepochs, startblock = 'final') {
    let block = await getBlockInfo(startblock);
    let latestBalance = await getAccountBalanceInPool(stakingpool_id, account_id, block.header.height);

    const balances = [];
    for (let n = 0; n < numepochs; n++) {
        const previousBalance = await getAccountBalanceInPool(stakingpool_id, account_id, block.header.next_epoch_id);

        balances.push({
            timestamp: new Date(block.header.timestamp / 1_000_000),
            balance: latestBalance,
            earnings: latestBalance - previousBalance,
            block_height: block.header.height,
            epoch_id: block.header.epoch_id
        });

        latestBalance = previousBalance;
        block = await getBlockInfo(block.header.next_epoch_id);
    }
    return balances;
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
        block = await getBlockData(stakingTransactions[0].block_height);
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
        const previousBalance = await retry(() => getAccountBalanceInPool(stakingpool_id, account_id, block.header.next_epoch_id));

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

        latestBalance = previousBalance;
        block = await retry(() => getBlockData(block.header.height - 43_200));
    }

    for (let stakingTransaction of stakingTransactions) {
        if (!stakingBalanceEntries.find(sbe => sbe.hash === stakingTransaction.hash)) {
            block = await retry(() => getBlockData(stakingTransaction.block_height));
            const stakingBalance = await retry(() => getAccountBalanceInPool(stakingpool_id, account_id, stakingTransaction.block_hash));
            stakingBalanceEntries.push({
                timestamp: new Date(stakingTransaction.block_timestamp / 1_000_000),
                balance: stakingBalance,
                hash: stakingTransaction.hash,
                block_height: block.header.height,
                epoch_id: block.header.epoch_id,
                next_epoch_id: block.header.next_epoch_id,
                deposit: stakingTransaction.signer_id == account_id ? parseInt(stakingTransaction.args.deposit) : 0,
                withdrawal: stakingTransaction.signer_id == stakingpool_id ? parseInt(stakingTransaction.args.deposit) : 0
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