import { readTextFile, exists, mkdir } from './gitstorage.js';
import { fixTransactionsWithoutBalance, getTransactionsToDate, viewAccount } from '../near/account.js';
import { writeFile } from './gitstorage.js';
import { fetchAllStakingEarnings } from '../near/stakingpool.js';
import { getFungibleTokenTransactionsToDate } from '../near/fungibletoken.js';
import { getBlockHeightAtDate, findLatestBalanceChangeWithExpansion, findBalanceChangingTransaction, RateLimitError, setStopSignal, getStopSignal } from '../near/balance-tracker.js';
import { setProgressbarValue, isStopRequested } from '../ui/progress-bar.js';
import { callViewFunction } from '../near/rpc.js';

export const accountdatadir = 'accountdata';
export const accountsconfigfile = 'accounts.json';
export const depositaccountsfile = 'depositaccounts.json';
export const ignorefungibletokensfile = 'ignorefungibletokens.json';
export const customexchangeratesfile = 'customexchangerates.json';
export const currencylistfile = 'currencylist.json';
export const customrealizationratesfile = 'realizations.json';
export const pricedatadir = 'pricehistory';

const allFungibleTokenSymbols = {};

// Cache for token metadata (symbol, decimals, icon)
const tokenMetadataCache = {};

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

    let startBlock, endBlock;

    // Handle block ID input (can be 'final', a number, or a date)
    if (typeof endDate === 'string' && (endDate === 'final' || !isNaN(parseInt(endDate)))) {
        // endDate is actually a block ID
        if (endDate === 'final') {
            endBlock = await getBlockHeightAtDate(new Date()); // Get current block height
            console.log(`Fetching transactions for ${account} using balance tracker`);
            console.log(`To block: final (${endBlock})`);
        } else {
            endBlock = parseInt(endDate);
            console.log(`Fetching transactions for ${account} using balance tracker`);
            console.log(`To block: ${endBlock}`);
        }

        // For start, handle different input types
        if (!startDate) {
            // Default: Fetch account creation block from NearBlocks API
            console.log(`Fetching account creation block from NearBlocks API for ${account}...`);
            try {
                const accountInfoResponse = await fetch(`https://api.nearblocks.io/v1/account/${account}`);
                const accountInfo = await accountInfoResponse.json();
                const creationTxHash = accountInfo.account[0]?.created?.transaction_hash;

                if (creationTxHash) {
                    // Fetch the transaction to get the block height
                    const txResponse = await fetch(`https://api.nearblocks.io/v1/txns/${creationTxHash}`);
                    const txInfo = await txResponse.json();
                    const creationBlock = txInfo.txns[0]?.block?.block_height;

                    if (creationBlock) {
                        // Start 100 blocks before account creation for safety
                        startBlock = Math.max(9820210, creationBlock - 100);
                        console.log(`From block: ${startBlock} (100 blocks before account creation at ${creationBlock})`);
                    } else {
                        // Fallback to genesis if we can't get creation block
                        startBlock = 9820210; // Genesis block
                        console.log(`From block: ${startBlock} (genesis - couldn't determine creation block)`);
                    }
                } else {
                    // Fallback to genesis if account info not found
                    startBlock = 9820210;
                    console.log(`From block: ${startBlock} (genesis - account not found in NearBlocks)`);
                }
            } catch (error) {
                console.warn('Error fetching account creation from NearBlocks:', error.message);
                // Fallback to genesis on error
                startBlock = 9820210;
                console.log(`From block: ${startBlock} (genesis - NearBlocks API error)`);
            }
        } else if (typeof startDate === 'number') {
            // startDate is already adjusted to be after the receipt block
            startBlock = startDate;
            console.log(`From block: ${startBlock} (after last existing transaction receipt)`);
        } else if (typeof startDate === 'string' && !isNaN(parseInt(startDate))) {
            startBlock = parseInt(startDate);
            console.log(`From block: ${startBlock}`);
        } else if (startDate instanceof Date) {
            startBlock = await getBlockHeightAtDate(startDate);
            console.log(`From: ${startDate.toISOString()} (block ${startBlock})`);
        }
    } else {
        // Traditional date-based input
        if (!endDate) endDate = new Date();
        if (!startDate) {
            startDate = new Date();
            startDate.setDate(startDate.getDate() - 1); // Default to last 24 hours
        }

        console.log(`Fetching transactions for ${account} using balance tracker`);
        console.log(`From: ${startDate.toISOString()}`);
        console.log(`To: ${endDate.toISOString()}`);

        // Get block heights
        startBlock = await getBlockHeightAtDate(startDate);
        endBlock = await getBlockHeightAtDate(endDate);
    }

    console.log(`Start block: ${startBlock}`);
    console.log(`End block: ${endBlock}`);

    // Load existing transactions
    let existingTransactions = await getTransactionsForAccount(account);
    let existingFtTransactions = await getAllFungibleTokenTransactions(account);

    // Keep original hashes separate - only stop when we find these
    const originalExistingHashes = new Set(existingTransactions.map(tx => tx.hash));
    const originalExistingFtHashes = new Set(existingFtTransactions.map(tx => tx.transaction_hash));

    // Track all hashes (original + newly found) to avoid duplicates within this search
    const allHashes = new Set(originalExistingHashes);
    const allFtHashes = new Set(originalExistingFtHashes);

    // Find balance changes incrementally
    let currentEndBlock = endBlock;
    let searchWindow = Math.min(86400, endBlock - startBlock); // 24 hours or range size
    const maxIterations = 100; // Safety limit
    let iteration = 0;

    const newTransactions = [];
    const newFtTransactions = [];

    // Track if we've reached existing transactions
    let reachedExistingTransactions = false;

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
                // If this was the first iteration and no changes found, stop
                if (iteration === 1 && newTransactions.length === 0) {
                    console.log('No transactions found in initial search, stopping');
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

            // Get the primary transaction (now fetched by balance tracker)
            const tx = txData.transactions[0];

            // Check if this transaction existed BEFORE we started this search
            if (originalExistingHashes.has(tx.hash)) {
                console.log(`Found existing transaction ${tx.hash}, stopping search`);
                reachedExistingTransactions = true;
                break; // Stop searching as we've reached transactions we already have
            }

            // Skip if we already found this transaction in THIS search session
            if (allHashes.has(tx.hash)) {
                console.log(`Already found transaction ${tx.hash} in this search, skipping duplicate`);
                currentEndBlock = change.block - 1;
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
            allHashes.add(tx.hash);

            console.log(`Found new transaction ${tx.hash} at block ${transaction.block_height}`);

            // Process fungible token changes (including intents tokens)
            if (change.tokensChanged) {
                for (const [tokenContract, tokenInfo] of Object.entries(change.tokensChanged)) {
                    // Fetch token metadata (will throw error if it fails)
                    const metadata = await getTokenMetadata(tokenContract);

                    const ftTx = {
                        transaction_hash: tx.hash,
                        block_height: txData.transactionBlock || change.block,
                        block_timestamp: txData.blockTimestamp ? BigInt(txData.blockTimestamp).toString() : BigInt(Date.now() * 1_000_000).toString(),
                        account_id: account,
                        delta_amount: tokenInfo.diff,
                        involved_account_id: tx.signerId === account ? tx.receiverId : tx.signerId,
                        balance: tokenInfo.end, // Balance after transaction from balance tracker
                        ft: {
                            contract_id: tokenContract,
                            symbol: metadata.symbol,
                            decimals: metadata.decimals
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

                    if (!allFtHashes.has(`${tx.hash}-${tokenContract}`)) {
                        newFtTransactions.push(ftTx);
                        allFtHashes.add(`${tx.hash}-${tokenContract}`);
                    }
                }
            }

            // Process intents tokens as fungible tokens
            if (change.intentsChanged) {
                for (const [token, tokenInfo] of Object.entries(change.intentsChanged)) {
                    // Extract contract ID from token format (e.g., "nep141:wrap.near" -> "wrap.near")
                    const contractId = token.replace('nep141:', '');

                    // Fetch token metadata (will throw error if it fails)
                    const metadata = await getTokenMetadata(contractId);

                    const ftTx = {
                        transaction_hash: `${tx.hash}-intents-${contractId}`,
                        block_height: txData.transactionBlock || change.block,
                        block_timestamp: txData.blockTimestamp ? BigInt(txData.blockTimestamp).toString() : BigInt(Date.now() * 1_000_000).toString(),
                        account_id: account,
                        delta_amount: tokenInfo.diff,
                        involved_account_id: 'intents.near',
                        balance: tokenInfo.end, // Balance after transaction from balance tracker
                        ft: {
                            contract_id: contractId,
                            symbol: metadata.symbol,
                            decimals: metadata.decimals
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

                    if (!allFtHashes.has(ftTx.transaction_hash)) {
                        newFtTransactions.push(ftTx);
                        allFtHashes.add(ftTx.transaction_hash);
                    }
                }
            }

            // Update search window if available
            if (change.searchStart !== undefined) {
                searchWindow = currentEndBlock - change.searchStart;
            }

            // Move to before the transaction block for next search
            currentEndBlock = (txData.transactionBlock || change.block) - 1;

            // Check if we should stop after this transaction
            if (reachedExistingTransactions) {
                break; // Break out of the main while loop
            }

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

    // Report results and reason for stopping
    console.log(`Found ${newTransactions.length} new NEAR transactions`);
    console.log(`Found ${newFtTransactions.length} new fungible token transactions`);

    if (reachedExistingTransactions) {
        console.log('Search stopped: Reached existing transactions');
    } else if (isStopRequested() || getStopSignal()) {
        console.log('Search stopped: User requested');
    } else if (iteration >= maxIterations) {
        console.log('Search stopped: Maximum iterations reached');
    } else {
        console.log('Search completed: Reached start block');
    }

    setProgressbarValue(null);

    return {
        transactions: allTransactions,
        ftTransactions: allFtTransactions,
        newTransactionsCount: newTransactions.length,
        newFtTransactionsCount: newFtTransactions.length,
        stoppedReason: reachedExistingTransactions ? 'existing_transactions' :
                       (isStopRequested() || getStopSignal()) ? 'user_stopped' :
                       iteration >= maxIterations ? 'max_iterations' : 'completed'
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

// Helper function to get token metadata (symbol, decimals)
async function getTokenMetadata(contractId) {
    // Check cache first
    if (tokenMetadataCache[contractId]) {
        return tokenMetadataCache[contractId];
    }

    // Call ft_metadata on the token contract
    const metadata = await callViewFunction(contractId, 'ft_metadata', {}, 'final');

    if (!metadata || metadata.decimals === undefined) {
        throw new Error(`Failed to fetch valid metadata for token contract ${contractId}. Missing decimals field.`);
    }

    const result = {
        symbol: metadata.symbol,
        decimals: metadata.decimals
    };

    // Cache the result
    tokenMetadataCache[contractId] = result;
    return result;
}

// Legacy helper function for backward compatibility
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