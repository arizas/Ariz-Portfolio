// Balance tracker for efficient transaction discovery using binary search
// Ported from nodescripts/balance-tracker.js for browser use

import { viewFunctionAsJson, viewAccount as viewAccountRpc, status as statusRpc } from '@near-js/jsonrpc-client';
import { getProxyClient, getTransactionStatusWithReceipts } from './rpc.js';

// Configuration
const RPC_DELAY_MS = 10;

// Cache for block heights at specific dates to reduce RPC calls
const blockHeightCache = new Map();

// Cache for balance snapshots to avoid redundant RPC calls
// Key format: `${accountId}:${blockId}:${tokenContracts}:${intentsTokens}:${checkNear}`
const balanceCache = new Map();

// Helper to add delay between RPC calls
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Custom error class for rate limiting
export class RateLimitError extends Error {
    constructor(message = 'Rate limit exceeded (429)') {
        super(message);
        this.name = 'RateLimitError';
        this.statusCode = 429;
    }
}

// Stop signal for cancellation
let stopSignal = false;

export function setStopSignal(value) {
    stopSignal = value;
}

export function getStopSignal() {
    return stopSignal;
}

// Helper to check for rate limit errors
function checkRateLimitError(error) {
    // In browser, we can't reliably detect 429 errors - they come as JsonRpcNetworkError
    // So we treat any network error as potential rate limiting to be safe
    if (error.name === 'JsonRpcNetworkError' ||
        error.message?.includes('JsonRpcNetworkError') ||
        error.message?.includes('Network request failed') ||
        error.message?.includes('ERR_FAILED')) {
        console.error('Network error detected (likely rate limit), stopping search:', error);
        stopSignal = true; // Stop all further calls
        throw new RateLimitError('Network error - stopping to prevent rate limiting');
    }

    // Still check for explicit 429s in case they come through
    if (error.statusCode === 429 ||
        error.code === 429 ||
        error.status === 429 ||
        (error.message && (error.message.includes('429') || error.message.includes('Too Many Requests'))) ||
        (error.cause && error.cause.status === 429) ||
        (error.cause && error.cause.code === 429)) {
        console.error('Rate limit detected, throwing RateLimitError', error);
        stopSignal = true; // Also set stop signal to prevent further calls
        throw new RateLimitError();
    }
}

// Wrapper for RPC calls to catch network-level 429s and use proxy client
async function wrapRpcCall(rpcFunction, client, ...args) {
    // Check stop signal before making the call
    if (stopSignal) {
        throw new Error('Operation cancelled - rate limit detected');
    }

    try {
        const result = await rpcFunction(client, ...args);
        return result;
    } catch (error) {
        // In browser, JsonRpcNetworkError is what we get for network issues including 429
        if (error.name === 'JsonRpcNetworkError' ||
            JSON.stringify(error).includes('JsonRpcNetworkError')) {
            console.error('JsonRpcNetworkError detected - stopping to prevent rate limiting:', error);
            stopSignal = true; // Set stop signal
            throw new RateLimitError('Network error - stopping to prevent rate limiting');
        }

        // Check if error message contains ERR_FAILED which might be 429
        if (error.message && error.message.includes('ERR_FAILED')) {
            console.warn('Network error detected (possibly rate limit), stopping search');
            stopSignal = true; // Set stop signal
            throw new RateLimitError('Network error - possible rate limit');
        }

        // Check if it's a 429 at any level (might still work in some environments)
        const errorStr = JSON.stringify(error);
        if (errorStr.includes('429') || errorStr.includes('Too Many Requests')) {
            console.error('Detected 429 in RPC response');
            stopSignal = true; // Set stop signal
            throw new RateLimitError();
        }

        // Always check for other rate limit patterns
        checkRateLimitError(error);

        throw error;
    }
}

// Get RPC client using proxy
async function getRpcClient() {
    return await getProxyClient();
}

/**
 * Get current block height
 * @returns {Promise<number>} Current block height
 */
async function getCurrentBlockHeight() {
    if (stopSignal) {
        throw new Error('Operation cancelled by user');
    }

    try {
        const client = await getRpcClient();
        const result = await wrapRpcCall(statusRpc, client);

        // The jsonrpc-client returns camelCase properties
        if (result?.syncInfo?.latestBlockHeight) {
            return result.syncInfo.latestBlockHeight;
        }
        throw new Error('Could not get current block height');
    } catch (error) {
        console.error('Failed to get current block height:', error);
        checkRateLimitError(error);
        throw error;
    }
}

/**
 * Get block height at a specific date/time
 * @param {Date|string} date - Date to get block height for
 * @returns {Promise<number>} Block height at the given date
 */
export async function getBlockHeightAtDate(date) {
    const dateStr = typeof date === 'string' ? date : date.toISOString();

    if (blockHeightCache.has(dateStr)) {
        return blockHeightCache.get(dateStr);
    }

    // Calculate approximate block height based on ~1 second block time
    const now = new Date();
    const targetDate = new Date(dateStr);
    const secondsDiff = Math.floor((now - targetDate) / 1000);

    // Get current block height
    const currentBlock = await getCurrentBlockHeight();
    const estimatedBlock = currentBlock - secondsDiff;

    blockHeightCache.set(dateStr, estimatedBlock);
    return estimatedBlock;
}

/**
 * View account details at specific block
 * @param {string} accountId - Account ID
 * @param {number|string} blockId - Block height or 'final'
 */
export async function viewAccount(accountId, blockId) {
    const client = await getRpcClient();

    const params = {
        accountId,
        finality: blockId === 'final' ? 'final' : undefined,
        blockId: blockId === 'final' ? undefined : blockId
    };

    if (stopSignal) {
        throw new Error('Operation cancelled by user');
    }

    try {
        await delay(RPC_DELAY_MS);
        const result = await wrapRpcCall(viewAccountRpc, client, params);
        return result;
    } catch (error) {
        // Check for rate limit first
        checkRateLimitError(error);

        // Check if account doesn't exist (gone before creation or after deletion)
        if (error.message?.includes('does not exist') ||
            error.cause?.name === 'UNKNOWN_ACCOUNT' ||
            (error.message?.includes('Server error') && error.data?.includes('does not exist'))) {
            // Return a balance of 0 to indicate account doesn't exist at this block
            // This will be treated as "no balance" by the caller
            console.log(`Account ${accountId} does not exist at block ${blockId}`);
            return {
                amount: '0',
                block_height: blockId,
                block_hash: '',
                locked: '0',
                code_hash: '11111111111111111111111111111111',
                storage_usage: 0,
                storage_paid_at: 0
            };
        }

        // Handle other server errors by retrying with a different block
        if (error.message?.includes('Server error') && blockId !== 'final' && typeof blockId === 'number') {
            console.warn(`Server error at block ${blockId}, retrying with block ${blockId - 1}`);
            return await viewAccount(accountId, blockId - 1);
        }

        throw error;
    }
}

/**
 * Get fungible token balances for account
 * @param {string} accountId
 * @param {number} blockId
 * @param {string[]} tokenContracts - List of token contracts to check
 * @returns {Promise<Object>} Map of token contract to balance
 */
async function getFungibleTokenBalances(accountId, blockId, tokenContracts = []) {
    const client = await getRpcClient();
    const balances = {};

    for (const token of tokenContracts) {
        if (stopSignal) {
            throw new Error('Operation cancelled by user');
        }

        try {
            await delay(RPC_DELAY_MS);
            const balance = await wrapRpcCall(viewFunctionAsJson, client, {
                accountId: token,
                methodName: 'ft_balance_of',
                argsBase64: btoa(JSON.stringify({ account_id: accountId })),
                blockId: blockId === 'final' ? undefined : blockId
            });
            balances[token] = balance || '0';
        } catch (e) {
            checkRateLimitError(e);
            // Token might not exist at this block or account has no balance
            balances[token] = '0';
        }
    }

    return balances;
}

/**
 * Get Intents multi-token balances
 * @param {string} accountId
 * @param {number} blockId
 * @returns {Promise<Object>} Map of token to balance
 */
async function getIntentsBalances(accountId, blockId) {
    const client = await getRpcClient();
    const balances = {};

    if (stopSignal) {
        throw new Error('Operation cancelled by user');
    }

    try {
        // First get the tokens owned by the account
        await delay(RPC_DELAY_MS);
        const tokens = await wrapRpcCall(viewFunctionAsJson, client, {
            accountId: 'intents.near',
            methodName: 'mt_tokens_for_owner',
            argsBase64: btoa(JSON.stringify({
                account_id: accountId
            })),
            blockId: blockId === 'final' ? undefined : blockId
        });

        if (!tokens || tokens.length === 0) {
            return balances;
        }

        // Extract token IDs from the token objects
        const tokenIds = tokens.map(token => typeof token === 'string' ? token : token.token_id);

        // Get balances for all tokens in batch
        try {
            if (stopSignal) {
                throw new Error('Operation cancelled by user');
            }

            await delay(RPC_DELAY_MS);
            const batchBalances = await wrapRpcCall(viewFunctionAsJson, client, {
                accountId: 'intents.near',
                methodName: 'mt_batch_balance_of',
                argsBase64: btoa(JSON.stringify({
                    token_ids: tokenIds,
                    account_id: accountId
                })),
                blockId: blockId === 'final' ? undefined : blockId
            });

            // Map the batch balances to our result object
            if (batchBalances && Array.isArray(batchBalances)) {
                tokenIds.forEach((tokenId, index) => {
                    balances[tokenId] = batchBalances[index] || '0';
                });
            }
        } catch (e) {
            checkRateLimitError(e);
            console.warn(`Could not get balances for intents tokens:`, e.message);
            // Fall back to individual queries if batch fails
            for (const token of tokens) {
                balances[token] = '0';
            }
        }
    } catch (e) {
        checkRateLimitError(e);
        // Account might not have any intents tokens
    }

    return balances;
}

/**
 * Get all balances (NEAR, fungible tokens, intents) for an account at a specific block
 */
export async function getAllBalances(accountId, blockId, tokenContracts = undefined, intentsTokens = undefined, checkNear = true) {
    const cacheKey = `${accountId}:${blockId}:${JSON.stringify(tokenContracts)}:${JSON.stringify(intentsTokens)}:${checkNear}`;

    if (balanceCache.has(cacheKey)) {
        console.log(`getAllBalances ${blockId} [CACHED]`);
        return balanceCache.get(cacheKey);
    }

    console.log(`getAllBalances ${blockId} tokenContracts: ${tokenContracts === null ? 'null' : tokenContracts === undefined ? 'undefined' : Array.isArray(tokenContracts) ? `[${tokenContracts.length} tokens]` : tokenContracts} intentsTokens: ${intentsTokens === null ? 'null' : intentsTokens === undefined ? 'undefined' : Array.isArray(intentsTokens) ? `[${intentsTokens.length} tokens]` : intentsTokens} checkNear: ${checkNear}`);

    const result = {
        near: '0',
        fungibleTokens: {},
        intentsTokens: {}
    };

    // Get NEAR balance
    if (checkNear) {
        try {
            const account = await viewAccount(accountId, blockId);
            result.near = account?.amount || '0';
        } catch (e) {
            // Account might not exist at this block
            if (!e.message?.includes('does not exist')) {
                throw e;
            }
        }
    }

    // Get fungible token balances if specified
    if (tokenContracts === null) {
        // Explicitly null means don't check any tokens
        result.fungibleTokens = {};
    } else if (tokenContracts !== undefined) {
        // Array provided - check those specific tokens
        if (tokenContracts.length > 0) {
            result.fungibleTokens = await getFungibleTokenBalances(accountId, blockId, tokenContracts);
        } else {
            result.fungibleTokens = {};
        }
    } else {
        // Undefined means use default tokens
        const defaultTokens = [
            '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', // USDC
            'wrap.near', // wNEAR
            'usdt.tether-token.near' // USDT
        ];
        console.log(`checking DEFAULT tokens at ${blockId}:`, defaultTokens);
        result.fungibleTokens = await getFungibleTokenBalances(accountId, blockId, defaultTokens);
    }

    // Get intents tokens if specified
    if (intentsTokens === null) {
        // Explicitly null means don't check any intents tokens
        result.intentsTokens = {};
    } else if (intentsTokens !== undefined) {
        // Array provided - check those specific tokens
        if (intentsTokens.length > 0) {
            console.log(`checking SPECIFIC intents tokens at ${blockId}:`, intentsTokens);
            const intentsBalances = {};

            try {
                if (stopSignal) {
                    throw new Error('Operation cancelled by user');
                }

                const client = await getRpcClient();
                await delay(RPC_DELAY_MS);
                const batchBalances = await wrapRpcCall(viewFunctionAsJson, client, {
                    accountId: 'intents.near',
                    methodName: 'mt_batch_balance_of',
                    argsBase64: btoa(JSON.stringify({
                        token_ids: intentsTokens,
                        account_id: accountId
                    })),
                    blockId: blockId === 'final' ? undefined : blockId
                });

                // Map the batch balances to our result object
                if (batchBalances && Array.isArray(batchBalances)) {
                    intentsTokens.forEach((token, index) => {
                        intentsBalances[token] = batchBalances[index] || '0';
                    });
                }
            } catch (e) {
                checkRateLimitError(e);
                console.warn(`Could not get batch balances for intents tokens:`, e.message);
                // Set all to 0 on error
                for (const token of intentsTokens) {
                    intentsBalances[token] = '0';
                }
            }

            result.intentsTokens = intentsBalances;
        } else {
            result.intentsTokens = {};
        }
    } else {
        // Undefined means auto-detect intents tokens
        console.log(`getIntentsBalances - fetching tokens for ${accountId} at block ${blockId}`);
        result.intentsTokens = await getIntentsBalances(accountId, blockId);
        console.log(`getIntentsBalances - tokens found: ${Object.keys(result.intentsTokens).length}`);
    }

    balanceCache.set(cacheKey, result);
    return result;
}

/**
 * Detect balance changes between two snapshots
 */
function detectBalanceChanges(startBalance, endBalance) {
    const changes = {
        hasChanges: false,
        nearChanged: false,
        tokensChanged: {},
        intentsChanged: {}
    };

    // Check NEAR balance
    const startNear = BigInt(startBalance.near || '0');
    const endNear = BigInt(endBalance.near || '0');
    if (startNear !== endNear) {
        changes.hasChanges = true;
        changes.nearChanged = true;
        changes.nearDiff = endNear - startNear;
    } else {
        // Don't include nearDiff if no change
        delete changes.nearDiff;
    }

    // Check fungible tokens
    const allTokens = new Set([
        ...Object.keys(startBalance.fungibleTokens || {}),
        ...Object.keys(endBalance.fungibleTokens || {})
    ]);

    for (const token of allTokens) {
        const startAmount = BigInt(startBalance.fungibleTokens?.[token] || '0');
        const endAmount = BigInt(endBalance.fungibleTokens?.[token] || '0');
        if (startAmount !== endAmount) {
            changes.hasChanges = true;
            changes.tokensChanged[token] = {
                start: startAmount.toString(),
                end: endAmount.toString(),
                diff: (endAmount - startAmount).toString()
            };
        }
    }

    // Check intents tokens
    const allIntentsTokens = new Set([
        ...Object.keys(startBalance.intentsTokens || {}),
        ...Object.keys(endBalance.intentsTokens || {})
    ]);

    for (const token of allIntentsTokens) {
        const startAmount = BigInt(startBalance.intentsTokens?.[token] || '0');
        const endAmount = BigInt(endBalance.intentsTokens?.[token] || '0');
        if (startAmount !== endAmount) {
            changes.hasChanges = true;
            changes.intentsChanged[token] = {
                start: startAmount.toString(),
                end: endAmount.toString(),
                diff: (endAmount - startAmount).toString()
            };
        }
    }

    return changes;
}

/**
 * Binary search to find exact block where balance changed
 * Returns the RECEIPT block (where balance actually changed)
 */
export async function findLatestBalanceChangingBlock(accountId, firstBlock, lastBlock, tokenContracts = undefined, intentsTokens = undefined, checkNear = true) {
    const numBlocks = lastBlock - firstBlock;
    console.log("findLatestBalanceChangingBlock", firstBlock, numBlocks, tokenContracts, intentsTokens, checkNear);

    // Get balances at start and end blocks
    const startBalance = await getAllBalances(accountId, firstBlock, tokenContracts, intentsTokens, checkNear);
    const endBalance = await getAllBalances(accountId, lastBlock, tokenContracts, intentsTokens, checkNear);

    // Detect what changed
    const detectedChanges = detectBalanceChanges(startBalance, endBalance);

    if (!detectedChanges.hasChanges) {
        detectedChanges.block = firstBlock;
        return detectedChanges;
    }

    if (numBlocks === 1) {
        // Balance changed between firstBlock and lastBlock
        // Return lastBlock as that's where the change occurred
        detectedChanges.block = lastBlock;
        return detectedChanges;
    }

    const middleBlock = lastBlock - Math.floor(numBlocks / 2);

    // Determine what to check in recursion
    const nearChanged = detectedChanges.nearChanged || false;

    // Build list of tokens to check in recursion (only those that changed)
    const changedTokens = [];

    // Add fungible tokens that changed
    if (detectedChanges.tokensChanged) {
        Object.keys(detectedChanges.tokensChanged).forEach(token => {
            if (!changedTokens.includes(token)) {
                changedTokens.push(token);
            }
        });
    }

    // Build list of intents tokens that changed
    const changedIntentsTokens = [];
    if (detectedChanges.intentsChanged) {
        Object.keys(detectedChanges.intentsChanged).forEach(token => {
            changedIntentsTokens.push(token);
        });
    }

    // Recursive call with only the tokens/balances that changed
    const lastHalfChanges = await findLatestBalanceChangingBlock(
        accountId,
        middleBlock,
        lastBlock,
        changedTokens.length > 0 ? changedTokens : null,
        changedIntentsTokens.length > 0 ? changedIntentsTokens : null,
        nearChanged  // Only check NEAR if it changed in outer call
    );

    if (lastHalfChanges.hasChanges) {
        return lastHalfChanges;
    } else {
        return await findLatestBalanceChangingBlock(
            accountId,
            firstBlock,
            middleBlock,
            changedTokens.length > 0 ? changedTokens : null,
            changedIntentsTokens.length > 0 ? changedIntentsTokens : null,
            nearChanged  // Only check NEAR if it changed in outer call
        );
    }
}

/**
 * Find transaction that caused a balance change
 * Uses the neardata.xyz API to get block data with receipt execution outcomes
 * @param {string} targetAccountId - The account whose balance changed
 * @param {number} balanceChangeBlock - The block where the balance changed (receipt block)
 */
export async function findBalanceChangingTransaction(targetAccountId, balanceChangeBlock) {
    if (stopSignal) {
        throw new Error('Operation cancelled by user');
    }

    try {
        // Fetch block data from neardata.xyz API
        const blockDataUrl = `https://a2.mainnet.neardata.xyz/v0/block/${balanceChangeBlock}`;
        console.log(`Fetching block data from ${blockDataUrl}`);

        const response = await fetch(blockDataUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch block data: ${response.status}`);
        }

        const blockData = await response.json();
        const blockTimestamp = blockData.block?.header?.timestamp;

        console.log(`Searching for receipts affecting ${targetAccountId} in block ${balanceChangeBlock}`);

        const matchingTxHashes = new Set();
        const transactions = [];

        // Check all shards for receipt execution outcomes
        for (const shard of blockData.shards || []) {
            for (const receiptOutcome of shard.receipt_execution_outcomes || []) {
                const receipt = receiptOutcome.receipt;
                const executionOutcome = receiptOutcome.execution_outcome;
                const txHash = receiptOutcome.tx_hash;

                const receiverId = receipt.receiver_id;
                const predecessorId = receipt.predecessor_id;
                const logs = executionOutcome?.outcome?.logs || [];

                let affectsTargetAccount = false;

                // Check if receipt directly involves the target account
                if (receiverId === targetAccountId || predecessorId === targetAccountId) {
                    affectsTargetAccount = true;
                }

                // Check receipt logs for EVENT_JSON entries mentioning the account
                if (!affectsTargetAccount) {
                    for (const log of logs) {
                        if (log.startsWith('EVENT_JSON:')) {
                            try {
                                const eventData = JSON.parse(log.substring('EVENT_JSON:'.length));
                                const eventStr = JSON.stringify(eventData);
                                if (eventStr.includes(targetAccountId)) {
                                    affectsTargetAccount = true;
                                    console.log('Found EVENT mentioning target account:', eventData);
                                    break;
                                }
                            } catch (e) {
                                // Skip invalid JSON
                            }
                        }
                    }
                }

                if (affectsTargetAccount && txHash && !matchingTxHashes.has(txHash)) {
                    console.log('Found receipt affecting target account:');
                    console.log('  tx_hash:', txHash);
                    console.log('  receiverId:', receiverId);
                    console.log('  predecessorId:', predecessorId);
                    console.log('  receiptId:', receipt.receipt_id);

                    matchingTxHashes.add(txHash);

                    // Find the transaction in the shards
                    for (const txShard of blockData.shards || []) {
                        for (const tx of txShard.chunk?.transactions || []) {
                            if (tx.hash === txHash) {
                                transactions.push(tx);
                                break;
                            }
                        }
                    }
                }
            }
        }

        if (transactions.length > 0 || matchingTxHashes.size > 0) {
            // Fetch full transaction details using RPC for each transaction hash
            const fetchedTransactions = [];

            for (const shard of blockData.shards || []) {
                for (const receiptOutcome of shard.receipt_execution_outcomes || []) {
                    const txHash = receiptOutcome.tx_hash;
                    const receipt = receiptOutcome.receipt;

                    if (matchingTxHashes.has(txHash) && receipt.receipt?.Action?.signer_id) {
                        const signerId = receipt.receipt.Action.signer_id;

                        try {
                            console.log(`Fetching transaction ${txHash} with signer ${signerId}`);
                            const txResult = await getTransactionStatusWithReceipts(txHash, signerId);

                            if (txResult?.transaction) {
                                const txInfo = txResult.transaction;
                                fetchedTransactions.push({
                                    hash: txHash,
                                    signerId: txInfo.signerId,
                                    receiverId: txInfo.receiverId,
                                    actions: txInfo.actions || []
                                });
                            }
                        } catch (error) {
                            console.error(`Error fetching transaction ${txHash}:`, error.message);
                        }
                    }
                }
            }

            return {
                transactions: fetchedTransactions.length > 0 ? fetchedTransactions : transactions,
                transactionHashes: Array.from(matchingTxHashes),
                transactionBlock: balanceChangeBlock, // May be in earlier block
                receiptBlock: balanceChangeBlock,
                blockTimestamp: blockTimestamp
            };
        }
    } catch (error) {
        console.error(`Error fetching block data from neardata.xyz:`, error.message);
        // Don't check rate limit error since this is a different API
    }

    // No transactions found
    return {
        transactions: [],
        transactionHashes: [],
        transactionBlock: null,
        receiptBlock: balanceChangeBlock,
        blockTimestamp: null
    };
}

/**
 * Find latest balance change with expanding search if needed
 */
export async function findLatestBalanceChangeWithExpansion(accountId, startBlock, endBlock) {
    if (stopSignal) {
        throw new Error('Operation cancelled by user');
    }

    // Try to find balance change in the given range
    const change = await findLatestBalanceChangingBlock(accountId, startBlock, endBlock);

    if (change.hasChanges) {
        change.searchStart = startBlock;
        return change;
    }

    // No changes found - expand search backwards
    let currentStart = startBlock;
    let currentEnd = startBlock;
    let searchWindow = endBlock - startBlock;
    let expansionCount = 0;
    const maxExpansions = 10;

    while (expansionCount < maxExpansions && currentStart > 0) {
        if (stopSignal) {
            throw new Error('Operation cancelled by user');
        }

        searchWindow *= 2; // Double the window
        currentStart = Math.max(0, currentEnd - searchWindow);

        console.log(`No changes found in blocks ${startBlock}-${endBlock}, expanding to ${currentStart}-${currentEnd} (expansion ${expansionCount + 1})`);

        const expandedChange = await findLatestBalanceChangingBlock(accountId, currentStart, currentEnd);

        if (expandedChange.hasChanges) {
            expandedChange.searchStart = currentStart;
            return expandedChange;
        }

        expansionCount++;
        currentEnd = currentStart;
    }

    // No changes found even after expansion
    return {
        hasChanges: false,
        block: startBlock
    };
}
