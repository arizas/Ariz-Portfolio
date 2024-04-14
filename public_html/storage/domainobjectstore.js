import { readTextFile, exists, mkdir } from './gitstorage.js';
import { getTransactionsToDate } from '../near/account.js';
import { writeFile } from './gitstorage.js';
import { fetchAllStakingEarnings } from '../near/stakingpool.js';
import { getFungibleTokenTransactionsToDate } from '../near/fungibletoken.js';

export const accountdatadir = 'accountdata';
export const accountsconfigfile = 'accounts.json';
export const customexchangeratesfile = 'customexchangerates.json';
export const pricedatadir = 'pricehistory';

const allFungibleTokenSymbols = {};

export async function getAllFungibleTokenSymbols() {
    const accounts = await getAccounts();
    for (const account of accounts) {
        const transactions = await getAllFungibleTokenTransactions(account);
        transactions.forEach(transaction => { allFungibleTokenSymbols[transaction.ft.symbol] = true });
    }
    return Object.keys(allFungibleTokenSymbols);
}

function getFungibleTokenTransactionsPath(account) {
    return `${accountdatadir}/${account}/fungible_token_transactions.json`;
}

export async function getAccounts() {
    return JSON.parse(await readTextFile(accountsconfigfile));
}

export async function setAccounts(accounts) {
    await writeFile(accountsconfigfile, JSON.stringify(accounts));
}

export async function getAllFungibleTokenTransactionsByTxHash(account) {
    const transactions = await getAllFungibleTokenTransactions(account);
    const transactionsMap = transactions.reduce((obj, tx) => {
        obj[tx.transaction_hash] = tx;
        return obj;
    }, {});
    return transactionsMap;
}

export async function getAllFungibleTokenTransactions(account) {
    const fungibleTokenTransactionsPath = getFungibleTokenTransactionsPath(account);
    if (await exists(fungibleTokenTransactionsPath)) {
        return JSON.parse(await readTextFile(fungibleTokenTransactionsPath));
    } else {
        return [];
    }
}

export async function getTransactionsForAccount(account, fungibleTokenSymbol) {
    if (fungibleTokenSymbol) {
        return (await getAllFungibleTokenTransactions(account))
            .filter(fttx => fttx.ft.symbol === fungibleTokenSymbol)
            .map(tx => ({ ...tx, hash: tx.transaction_hash }));
    } else {
        const accountdatapath = `${accountdatadir}/${account}/transactions.json`;
        if (await exists(accountdatapath)) {
            return JSON.parse(await readTextFile(accountdatapath));
        } else {
            return [];
        }
    }
}

async function makeDirs(path) {
    const dirs = path.split('/');
    for (let n = 0; n < dirs.length - 1; n++) {
        const dir = dirs.slice(0, n + 1).join('/');
        if (!await exists(dir)) {
            await mkdir(dir);
        }
    }
}

async function makeAccountDataDirs(account) {
    if (!await exists(accountdatadir)) {
        await mkdir(accountdatadir);
    }

    const accountdir = `${accountdatadir}/${account}`;
    if (!await exists(accountdir)) {
        await mkdir(accountdir);
    }
}

export async function fetchTransactionsForAccount(account, max_timestamp = new Date().getTime() * 1_000_000) {
    let transactions = await getTransactionsForAccount(account);
    transactions = await getTransactionsToDate(account, max_timestamp, transactions);

    await writeTransactions(account, transactions);
    return transactions;
}

export async function fetchFungibleTokenTransactionsForAccount(account, max_timestamp = BigInt(new Date().getTime()) * 1_000_000n) {
    let transactions = await getAllFungibleTokenTransactions(account);
    transactions = await getFungibleTokenTransactionsToDate(account, max_timestamp, transactions);
    await writeFungibleTokenTransactions(account, transactions);
    return transactions;
}

export async function writeFungibleTokenTransactions(account, transactions) {
    const fungibleTokenTransactionsPath = getFungibleTokenTransactionsPath(account);
    await makeDirs(fungibleTokenTransactionsPath);
    await writeFile(fungibleTokenTransactionsPath, JSON.stringify(transactions, null, 1));
}

export async function writeTransactions(account, transactions) {
    await makeAccountDataDirs(account);
    await writeFile(`${accountdatadir}/${account}/transactions.json`, JSON.stringify(transactions, null, 1));
}

function getStakingDataDir(account) {
    return `${accountdatadir}/${account}/stakingpools`;
}

function getStakingDataPath(account, stakingpool_id) {
    return `${getStakingDataDir(account)}/${stakingpool_id}.json`;
}

export async function getStakingRewardsForAccountAndPool(account, stakingpool_id, fungibleTokenSymbol) {
    if (fungibleTokenSymbol) {
        return [];
    }
    const stakingDataPath = getStakingDataPath(account, stakingpool_id);
    if ((await exists(stakingDataPath))) {
        return JSON.parse(await readTextFile(stakingDataPath));
    } else {
        return [];
    }
}

export async function fetchStakingRewardsForAccountAndPool(account, stakingpool_id) {
    const currentStakingEarnings = await getStakingRewardsForAccountAndPool(account, stakingpool_id);
    const updatedStakingEarnings = await fetchAllStakingEarnings(stakingpool_id, account, currentStakingEarnings);

    await writeStakingData(account, stakingpool_id, updatedStakingEarnings);
}

export async function writeStakingData(account, stakingpool_id, stakingData) {
    await makeAccountDataDirs(account);
    const stakingDataDir = getStakingDataDir(account);
    if (!(await exists(stakingDataDir))) {
        await mkdir(stakingDataDir);
    }
    const stakingDataPath = getStakingDataPath(account, stakingpool_id);
    await writeFile(stakingDataPath, JSON.stringify(stakingData, null, 1));
}

function getPriceDataPath(token, targetCurrency) {
    return `${pricedatadir}/${token}/${targetCurrency}.json`;
}

export async function getHistoricalPriceData(token, targetCurrency) {
    const pricedatapath = getPriceDataPath(token, targetCurrency);
    if (await exists(pricedatapath)) {
        return JSON.parse(await readTextFile(pricedatapath));
    } else {
        return {};
    }
}

export async function setHistoricalPriceData(token, targetCurrency, pricedata) {
    const pricedatapath = getPriceDataPath(token, targetCurrency);
    await makeDirs(pricedatapath);
    await writeFile(pricedatapath, JSON.stringify(pricedata, null, 1));
}

export async function getCustomExchangeRates() {
    if ((await exists(customexchangeratesfile))) {
        return JSON.parse(await readTextFile(customexchangeratesfile));
    } else {
        return {};
    }
}

export async function setCustomExchangeRates(customExchangeRates) {
    await writeFile(customexchangeratesfile, JSON.stringify(customExchangeRates, null, 1));
}

export async function setCustomExchangeRatesFromTable(customExchangeRatesTable) {
    const customExchangeRates = {};
    customExchangeRatesTable.forEach(customExchangeRate => {
        if (!customExchangeRates[customExchangeRate.currency]) {
            customExchangeRates[customExchangeRate.currency] = {};
        }
        customExchangeRates[customExchangeRate.currency][customExchangeRate.date] = {
            buy: customExchangeRate.buysell == 'buy' ? customExchangeRate.price : undefined,
            sell: customExchangeRate.buysell == 'sell' ? customExchangeRate.price : undefined,
        };
    });
    await setCustomExchangeRates(customExchangeRates);
}

export async function getCustomExchangeRatesAsTable() {
    const customExchangeRates = await getCustomExchangeRates();
    const customExchangeRatesTable = [];
    Object.keys(customExchangeRates).forEach(currency => {
        Object.keys(customExchangeRates[currency]).forEach(date => {
            if (customExchangeRates[currency][date].buy) {
                customExchangeRatesTable.push({
                    date,
                    currency,
                    price: customExchangeRates[currency][date].buy,
                    buysell: 'buy'
                });
            }
            if (customExchangeRates[currency][date].sell) {
                customExchangeRatesTable.push({
                    date,
                    currency,
                    price: customExchangeRates[currency][date].sell,
                    buysell: 'sell'
                });
            }
        });
    });
    return customExchangeRatesTable;
}