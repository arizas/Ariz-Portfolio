import { readTextFile, exists, mkdir } from './gitstorage.js';
import { getTransactionsToDate } from '../near/account.js';
import { writeFile } from './gitstorage.js';
import { fetchAllStakingEarnings } from '../near/stakingpool.js';

export const accountdatadir = 'accountdata';
export const accountsconfigfile = 'accounts.json';

export async function getAccounts() {
    return JSON.parse(await readTextFile(accountsconfigfile));
}
export async function setAccounts(accounts) {
    await writeFile(accountsconfigfile, JSON.stringify(accounts));
}

export async function getTransactionsForAccount(account) {
    const accountdatapath = `${accountdatadir}/${account}/transactions.json`;
    if (await exists(accountdatapath)) {
        return JSON.parse(await readTextFile(accountdatapath));
    } else {
        return [];
    }
}

export async function fetchTransactionsForAccount(account, max_timestamp = new Date().getTime() * 1_000_000) {
    if (!await exists(accountdatadir)) {
        await mkdir(accountdatadir);
    }

    const accountdir = `${accountdatadir}/${account}`;
    if (!await exists(accountdir)) {
        await mkdir(accountdir);
    }

    let transactions = await getTransactionsForAccount(account);
    transactions = await getTransactionsToDate(account, max_timestamp, transactions);

    await writeFile(`${accountdatadir}/${account}/transactions.json`, JSON.stringify(transactions, null, 1));
    return transactions;
}

function getStakingDataDir(account) {
    return `${accountdatadir}/${account}/stakingpools`;
}

function getStakingDataPath(account, stakingpool_id) {
    return `${getStakingDataDir(account)}/${stakingpool_id}.json`;
}

export async function getStakingRewardsForAccountAndPool(account, stakingpool_id) {
    const stakingDataPath = getStakingDataPath(account, stakingpool_id);
    if ((await exists(stakingDataPath))) {
        return JSON.parse(await readTextFile(stakingDataPath));
    } else {
        return [];
    }
}

export async function fetchStakingRewardsForAccountAndPool(account, stakingpool_id) {
    const stakingDataDir = getStakingDataDir(account);
    if (!(await exists(stakingDataDir))) {
        await mkdir(stakingDataDir);
    }
    const currentStakingEarnings = await getStakingRewardsForAccountAndPool(account, stakingpool_id);
    const updatedStakingEarnings = await fetchAllStakingEarnings(stakingpool_id, account, currentStakingEarnings);
    
    const stakingDataPath = getStakingDataPath(account, stakingpool_id);
    await writeFile(stakingDataPath,JSON.stringify(updatedStakingEarnings, null, 1));
}