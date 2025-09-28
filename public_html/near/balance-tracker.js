// Balance tracker for efficient transaction discovery using binary search
// Ported from nodescripts/balance-tracker.js for browser use

import { NearRpcClient, viewFunctionAsJson, viewAccount as viewAccountRpc, status as statusRpc, block as blockRpc, chunk as chunkRpc } from '@near-js/jsonrpc-client';

// Configuration
const RPC_URL = 'https://archival-rpc.mainnet.fastnear.com';
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
    // Check various error formats
    if (error.statusCode === 429 ||
        error.code === 429 ||
        error.status === 429 ||
        (error.message && (error.message.includes('429') || error.message.includes('Too Many Requests') || error.message.includes('ERR_FAILED'))) ||
        (error.cause && error.cause.status === 429) ||
        (error.cause && error.cause.code === 429)) {
        console.error('Rate limit detected, throwing RateLimitError');
        throw new RateLimitError();
    }

    // Also check if it's a network error that might be rate limiting
    if (error.message && error.message.includes('ERR_FAILED') && error.message.includes('429')) {
        console.error('Network 429 detected, throwing RateLimitError');
        throw new RateLimitError();
    }
}

// Create client instance
const client = new NearRpcClient(RPC_URL);

// Wrapper for RPC calls to catch network-level 429s
async function wrapRpcCall(rpcFunction, ...args) {
    try {
        const result = await rpcFunction(...args);
        return result;
    } catch (error) {
        // Check if error message contains ERR_FAILED which might be 429
        if (error.message && error.message.includes('ERR_FAILED')) {
            console.warn('Network error detected (possibly rate limit), stopping search');
            // For now, treat all ERR_FAILED as potential rate limits
            throw new RateLimitError('Network error - possible rate limit');
        }

        // Check if it's a 429 at any level
        const errorStr = JSON.stringify(error);
        if (errorStr.includes('429') || errorStr.includes('Too Many Requests')) {
            console.error('Detected 429 in RPC response');
            throw new RateLimitError();
        }

        // Check the response object if it exists
        if (error.response && error.response.status === 429) {
            throw new RateLimitError();
        }

        // Check for fetch errors that might indicate rate limiting
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            console.warn('Fetch error - might be rate limiting');
        }

        throw error;
    }
}

// Get RPC client
function getRpcClient() {
    return client;
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
        const client = getRpcClient();
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
    const client = getRpcClient();

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

        // Handle server errors by retrying with a different block
        if (error.message?.includes('Server error') && blockId !== 'final' && typeof blockId === 'number') {
            console.warn(`Server error at block ${blockId}, retrying with block ${blockId - 1}`);
            return await viewAccount(accountId, blockId - 1);
        }
        // Re-throw with cleaner error message
        if (error.message?.includes('does not exist')) {
            throw new Error(`Account ${accountId} does not exist at block ${blockId}`);
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
    const client = getRpcClient();
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
    const client = getRpcClient();
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
            'wrap.near' // wNEAR
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

                const client = getRpcClient();
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
        nearDiff: 0n,
        tokensChanged: null,
        intentsChanged: null
    };

    // Check NEAR balance
    const startNear = BigInt(startBalance.near || '0');
    const endNear = BigInt(endBalance.near || '0');
    if (startNear !== endNear) {
        changes.hasChanges = true;
        changes.nearChanged = true;
        changes.nearDiff = endNear - startNear;
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
            if (!changes.tokensChanged) changes.tokensChanged = {};
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
            if (!changes.intentsChanged) changes.intentsChanged = {};
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
 * Searches backwards from receipt block to find originating transaction
 */
export async function findBalanceChangingTransaction(accountId, balanceChangeBlock, maxBlocksBack = 10) {
    const client = getRpcClient();

    // Search backwards from the balance change block
    for (let blockOffset = 0; blockOffset <= maxBlocksBack; blockOffset++) {
        if (stopSignal) {
            throw new Error('Operation cancelled by user');
        }

        const searchBlock = balanceChangeBlock - blockOffset;
        if (searchBlock < 0) break;

        try {
            // Get the block
            const blockResult = await wrapRpcCall(blockRpc, client, { blockId: searchBlock });

            const relevantTransactions = [];
            const blockTimestamp = blockResult.header.timestamp;

            // Check all chunks in the block
            for (const chunkHeader of blockResult.chunks) {
                if (stopSignal) {
                    throw new Error('Operation cancelled by user');
                }

                const chunkResult = await wrapRpcCall(chunkRpc, client, {
                    blockId: blockResult.header.hash,
                    chunkId: chunkHeader.chunkHash,
                    shardId: chunkHeader.shardId
                });

                // Find transactions that involve the account
                for (const tx of chunkResult.transactions) {
                    // Check if transaction involves the account
                    if (tx.signerId === accountId || tx.receiverId === accountId) {
                        relevantTransactions.push(tx);
                    }

                    // Check for intents.near transactions
                    if (tx.receiverId === 'intents.near') {
                        for (const action of tx.actions) {
                            if (action.FunctionCall && action.FunctionCall.methodName === 'execute_intents') {
                                try {
                                    const decodedArgs = JSON.parse(atob(action.FunctionCall.args));
                                    if (decodedArgs.signed) {
                                        for (const signedIntent of decodedArgs.signed) {
                                            if (signedIntent.payload && signedIntent.payload.message) {
                                                const message = JSON.parse(signedIntent.payload.message);
                                                if (message.signer_id === accountId) {
                                                    relevantTransactions.push(tx);
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                } catch (e) {
                                    // Skip if can't decode
                                }
                            }
                        }
                    }
                }
            }

            // If we found transactions, return them with block info
            if (relevantTransactions.length > 0) {
                return {
                    transactions: relevantTransactions,
                    transactionBlock: searchBlock,
                    receiptBlock: balanceChangeBlock,
                    blockTimestamp: blockTimestamp
                };
            }
        } catch (error) {
            checkRateLimitError(error);
            console.error(`Error checking block ${searchBlock}:`, error.message);
        }
    }

    // No transactions found
    return {
        transactions: [],
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
