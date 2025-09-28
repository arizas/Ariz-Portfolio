import { readTextFile, exists, mkdir } from './gitstorage.js';
import { fixTransactionsWithoutBalance, getTransactionsToDate, viewAccount } from '../near/account.js';
import { writeFile } from './gitstorage.js';
import { fetchAllStakingEarnings } from '../near/stakingpool.js';
import { getFungibleTokenTransactionsToDate } from '../near/fungibletoken.js';
import { getBlockHeightAtDate, findLatestBalanceChangeWithExpansion, findBalanceChangingTransaction, RateLimitError, setStopSignal, getStopSignal } from '../near/balance-tracker.js';
import { setProgressbarValue, isStopRequested } from '../ui/progress-bar.js';

export const accountdatadir = 'accountdata';
export const accountsconfigfile = 'accounts.json';
export const depositaccountsfile = 'depositaccounts.json';
export const ignorefungibletokensfile = 'ignorefungibletokens.json';
export const customexchangeratesfile = 'customexchangerates.json';
export const currencylistfile = 'currencylist.json';
export const customrealizationratesfile = 'realizations.json';
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

export async function getDepositAccounts() {
    const defaultDepositAccounts = {
    };
    if (await exists(depositaccountsfile)) {
        return Object.assign(defaultDepositAccounts, JSON.parse(await readTextFile(depositaccountsfile)));
    } else {
        await setDepositAccounts(defaultDepositAccounts);
        return defaultDepositAccounts;
    }
}

export async function setDepositAccounts(depositaccounts) {
    await writeFile(depositaccountsfile, JSON.stringify(depositaccounts));
}

export async function getIgnoredFungibleTokens() {
    if (await exists(ignorefungibletokensfile)) {
        return JSON.parse(await readTextFile(ignorefungibletokensfile));
    } else {
        return [];
    }
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
        const transactions = JSON.parse(await readTextFile(fungibleTokenTransactionsPath));
        // Ensure all fungible token transactions have args field for backward compatibility
        return transactions.map(tx => ({
            ...tx,
            args: tx.args || {}
        }));
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
            const transactions = JSON.parse(await readTextFile(accountdatapath));
            // Ensure all transactions have args field for backward compatibility
            return transactions.map(tx => ({
                ...tx,
                args: tx.args || {}
            }));
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

/**
 * Fetch transactions using balance tracker - incremental approach
 * @param {string} account - Account to fetch transactions for
 * @param {Date} startDate - Optional start date (defaults to 24h ago)
 * @param {Date} endDate - Optional end date (defaults to now)
 * @returns {Promise<Object>} Object with transactions and fungible token transactions
 */
export async function fetchTransactionsUsingBalanceTracker(account, startDate = null, endDate = null) {
    // Reset stop signal at the beginning
    setStopSignal(false);

    if (!endDate) endDate = new Date();
    if (!startDate) {
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 1); // Default to last 24 hours
    }

    console.log(`Fetching transactions for ${account} using balance tracker`);
    console.log(`From: ${startDate.toISOString()}`);
    console.log(`To: ${endDate.toISOString()}`);

    // Get block heights
    const startBlock = await getBlockHeightAtDate(startDate);
    const endBlock = await getBlockHeightAtDate(endDate);

    console.log(`Start block: ${startBlock}`);
    console.log(`End block: ${endBlock}`);

    // Load existing transactions
    let existingTransactions = await getTransactionsForAccount(account);
    let existingFtTransactions = await getAllFungibleTokenTransactions(account);

    const existingHashes = new Set(existingTransactions.map(tx => tx.hash));
    const existingFtHashes = new Set(existingFtTransactions.map(tx => tx.transaction_hash));

    // Find balance changes incrementally
    let currentEndBlock = endBlock;
    let searchWindow = Math.min(86400, endBlock - startBlock); // 24 hours or range size
    const maxIterations = 100; // Safety limit
    let iteration = 0;

    const newTransactions = [];
    const newFtTransactions = [];

    // TEMPORARY: Only find one transaction for testing
    const maxTransactionsToFind = 1;
    let transactionsFound = 0;

    while (currentEndBlock > startBlock && iteration < maxIterations) {
        iteration++;
        const currentStartBlock = Math.max(startBlock, currentEndBlock - searchWindow);

        // Check if stop was requested before updating progress
        if (isStopRequested()) {
            console.log('User stopped the search (before progress update)');
            setStopSignal(true);
            break;
        }

        const progressResult = setProgressbarValue(
            (endBlock - currentEndBlock) / (endBlock - startBlock),
            `${account}: Searching blocks ${currentStartBlock} to ${currentEndBlock}`,
            true // Show stop button
        );

        // Also check right after setting progress (in case it was just clicked)
        if (isStopRequested()) {
            console.log('User stopped the search (after progress update)');
            setStopSignal(true);
            break;
        }

        try {
            // Find balance change in this window
            const change = await findLatestBalanceChangeWithExpansion(account, currentStartBlock, currentEndBlock);

            // Check if stop was requested during the async operation
            if (isStopRequested()) {
                console.log('User stopped the search (checked after async operation)');
                setStopSignal(true);
                break;
            }

            if (!change.hasChanges) {
                console.log(`No changes found in blocks ${currentStartBlock}-${currentEndBlock}, moving to earlier blocks`);
                // If we only wanted one transaction and expansion didn't find it, stop
                if (maxTransactionsToFind === 1 && transactionsFound === 0) {
                    console.log('No transactions found in expanded search, stopping');
                    break;
                }
                currentEndBlock = currentStartBlock - 1;
                continue;
            }

            // Get transaction details
            const txData = await findBalanceChangingTransaction(account, change.block);

            // Check again after async operation
            if (isStopRequested()) {
                console.log('User stopped the search (after finding transaction)');
                setStopSignal(true);
                break;
            }

            if (txData.transactions.length === 0) {
                console.log(`No transaction found for balance change at block ${change.block}`);
                currentEndBlock = change.block - 1;
                continue;
            }

            // Get the primary transaction
            const tx = txData.transactions[0];

            // Skip if we already have this transaction
            if (existingHashes.has(tx.hash)) {
                console.log(`Skipping duplicate transaction ${tx.hash}`);
                currentEndBlock = (txData.transactionBlock || change.block) - 1;
                continue;
            }

            // Get balance after this transaction
            let balance = '0';
            try {
                const accountData = await viewAccount(txData.receiptBlock || change.block, account);
                balance = accountData?.amount || '0';
            } catch (e) {
                console.warn(`Could not get balance at block ${change.block}:`, e.message);
            }

            // Create NEAR transaction record
            const transaction = {
                hash: tx.hash,
                block_height: txData.transactionBlock || change.block,
                block_timestamp: txData.blockTimestamp ? BigInt(txData.blockTimestamp).toString() : BigInt(Date.now() * 1_000_000).toString(),
                signer_id: tx.signerId,
                receiver_id: tx.receiverId,
                balance: balance,
                action_kind: detectActionKind(tx),
                args: {} // Always include args object
            };

            // Add method_name for FUNCTION_CALL transactions
            if (transaction.action_kind === 'FUNCTION_CALL' && tx.actions && tx.actions.length > 0) {
                const functionCallAction = tx.actions[0].FunctionCall;
                if (functionCallAction) {
                    // RPC returns methodName (camelCase), not method_name (snake_case)
                    transaction.args.method_name = functionCallAction.methodName || functionCallAction.method_name || undefined;
                }
            }

            newTransactions.push(transaction);
            existingHashes.add(tx.hash);
            transactionsFound++;

            console.log(`Found transaction ${transactionsFound}/${maxTransactionsToFind}, stopping after ${maxTransactionsToFind}`);

            // Stop after finding the desired number of transactions
            if (transactionsFound >= maxTransactionsToFind) {
                console.log('Reached transaction limit, stopping search');
                break;
            }

            // Process fungible token changes (including intents tokens)
            if (change.tokensChanged) {
                for (const [tokenContract, tokenInfo] of Object.entries(change.tokensChanged)) {
                    const ftTx = {
                        transaction_hash: tx.hash,
                        block_height: txData.transactionBlock || change.block,
                        block_timestamp: txData.blockTimestamp ? BigInt(txData.blockTimestamp).toString() : BigInt(Date.now() * 1_000_000).toString(),
                        account_id: account,
                        delta_amount: tokenInfo.diff,
                        involved_account_id: tx.signerId === account ? tx.receiverId : tx.signerId,
                        ft: {
                            contract_id: tokenContract,
                            symbol: getTokenSymbol(tokenContract),
                            icon: null
                        },
                        args: {} // Always include args field
                    };

                    // Add method_name for FUNCTION_CALL transactions
                    if (tx.actions && tx.actions.length > 0 && tx.actions[0].FunctionCall) {
                        const functionCallAction = tx.actions[0].FunctionCall;
                        if (functionCallAction) {
                            // RPC returns methodName (camelCase), not method_name (snake_case)
                            ftTx.args.method_name = functionCallAction.methodName || functionCallAction.method_name || undefined;
                        }
                    }

                    if (!existingFtHashes.has(`${tx.hash}-${tokenContract}`)) {
                        newFtTransactions.push(ftTx);
                        existingFtHashes.add(`${tx.hash}-${tokenContract}`);
                    }
                }
            }

            // Process intents tokens as fungible tokens
            if (change.intentsChanged) {
                for (const [token, tokenInfo] of Object.entries(change.intentsChanged)) {
                    // Extract contract ID from token format (e.g., "nep141:wrap.near" -> "wrap.near")
                    const contractId = token.replace('nep141:', '');

                    const ftTx = {
                        transaction_hash: `${tx.hash}-intents-${contractId}`,
                        block_height: txData.transactionBlock || change.block,
                        block_timestamp: txData.blockTimestamp ? BigInt(txData.blockTimestamp).toString() : BigInt(Date.now() * 1_000_000).toString(),
                        account_id: account,
                        delta_amount: tokenInfo.diff,
                        involved_account_id: 'intents.near',
                        ft: {
                            contract_id: contractId,
                            symbol: getTokenSymbol(contractId),
                            icon: null
                        },
                        args: {} // Always include args field
                    };

                    // Add method_name for FUNCTION_CALL transactions
                    if (tx.actions && tx.actions.length > 0 && tx.actions[0].FunctionCall) {
                        const functionCallAction = tx.actions[0].FunctionCall;
                        if (functionCallAction) {
                            // RPC returns methodName (camelCase), not method_name (snake_case)
                            ftTx.args.method_name = functionCallAction.methodName || functionCallAction.method_name || undefined;
                        }
                    }

                    if (!existingFtHashes.has(ftTx.transaction_hash)) {
                        newFtTransactions.push(ftTx);
                        existingFtHashes.add(ftTx.transaction_hash);
                    }
                }
            }

            // Update search window if available
            if (change.searchStart !== undefined) {
                searchWindow = currentEndBlock - change.searchStart;
            }

            // Move to before the transaction block for next search
            currentEndBlock = (txData.transactionBlock || change.block) - 1;

        } catch (error) {
            // Check if it's a rate limit error
            if (error instanceof RateLimitError || error.statusCode === 429 ||
                error.message?.includes('429') || error.message?.includes('Too Many Requests')) {
                console.error('Rate limit exceeded (429), stopping search immediately');
                setProgressbarValue(null, 'Search stopped: Rate limit exceeded');
                break;
            }

            // Check if user cancelled
            if (error.message?.includes('Operation cancelled')) {
                console.log('Search cancelled by user');
                setProgressbarValue(null, 'Search cancelled');
                break;
            }

            console.error(`Error processing blocks ${currentStartBlock}-${currentEndBlock}:`, error);
            // Move to next window on other errors
            currentEndBlock = currentStartBlock - 1;
        }
    }

    // Merge with existing transactions and sort
    const allTransactions = [...existingTransactions, ...newTransactions]
        .sort((a, b) => b.block_height - a.block_height);

    const allFtTransactions = [...existingFtTransactions, ...newFtTransactions]
        .sort((a, b) => b.block_height - a.block_height);

    // Save to storage
    await writeTransactions(account, allTransactions);
    await writeFungibleTokenTransactions(account, allFtTransactions);

    // Check if we were stopped
    const wasStopped = isStopRequested() || getStopSignal();

    console.log(`Found ${newTransactions.length} new NEAR transactions`);
    console.log(`Found ${newFtTransactions.length} new fungible token transactions`);

    if (wasStopped) {
        console.log('Search was stopped early');
    }

    setProgressbarValue(null);

    return {
        transactions: allTransactions,
        ftTransactions: allFtTransactions,
        newTransactionsCount: newTransactions.length,
        newFtTransactionsCount: newFtTransactions.length
    };
}

// Helper function to detect action kind from transaction
function detectActionKind(tx) {
    if (!tx.actions || tx.actions.length === 0) return 'UNKNOWN';

    const action = tx.actions[0];
    const actionType = Object.keys(action)[0];

    switch(actionType) {
        case 'FunctionCall': return 'FUNCTION_CALL';
        case 'Transfer': return 'TRANSFER';
        case 'Stake': return 'STAKE';
        case 'AddKey': return 'ADD_KEY';
        case 'DeleteKey': return 'DELETE_KEY';
        case 'CreateAccount': return 'CREATE_ACCOUNT';
        case 'DeleteAccount': return 'DELETE_ACCOUNT';
        case 'DeployContract': return 'DEPLOY_CONTRACT';
        default: return actionType.toUpperCase();
    }
}

// Helper function to get token symbol
function getTokenSymbol(contractId) {
    const symbols = {
        '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1': 'USDC',
        'wrap.near': 'wNEAR',
        'btc.omft.near': 'BTC',
        'eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near': 'USDT'
    };
    return symbols[contractId] || contractId.split('.')[0].toUpperCase();
}

export async function fixTransactionsBalancesForAccount(account) {
    let transactions = await getTransactionsForAccount(account);
    await fixTransactionsWithoutBalance({account, transactions});

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
    return `${pricedatadir}/${token}/${targetCurrency.toLowerCase()}.json`;
}

export async function getHistoricalPriceData(token, targetCurrency) {
    if (!token) {
        token = 'NEAR';
    } else if (token === 'wNEAR') {
        token = 'NEAR';
    }
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

export async function getCustomRealizationRates() {
    if ((await exists(customrealizationratesfile))) {
        return JSON.parse(await readTextFile(customrealizationratesfile));
    } else {
        return {};
    }
}

export async function setCustomRealizationRates(customRealizationRatesObj) {
    await makeDirs(customrealizationratesfile);
    await writeFile(customrealizationratesfile, JSON.stringify(customRealizationRatesObj, null, 1));
}

export async function getCustomExchangeRates() {
    if ((await exists(customexchangeratesfile))) {
        return JSON.parse(await readTextFile(customexchangeratesfile));
    } else {
        return {};
    }
}

export async function getCurrencyList() {
    if ((await exists(currencylistfile))) {
        return JSON.parse(await readTextFile(currencylistfile));
    } else {
        return [];
    }
}

export async function setCurrencyList(currencyList) {
    await writeFile(currencylistfile, JSON.stringify(currencyList, null, 1));
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