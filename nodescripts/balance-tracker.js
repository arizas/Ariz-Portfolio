import { NearRpcClient, viewFunctionAsJson, viewAccount as viewAccountRpc, status } from '@near-js/jsonrpc-client';

// Configuration
const RPC_URL = process.env.NEAR_RPC_URL || 'https://archival-rpc.mainnet.fastnear.com';
const RPC_DELAY_MS = process.env.RPC_DELAY_MS ? parseInt(process.env.RPC_DELAY_MS) : 100;

// Cache for block heights at specific dates to reduce RPC calls
const blockHeightCache = new Map();

// Create client instance
const client = new NearRpcClient(RPC_URL);

// Helper to add delay between RPC calls
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Get RPC client
 */
function getRpcClient() {
    return client;
}

/**
 * Get current block height
 * @returns {Promise<number>} Current block height
 */
async function getCurrentBlockHeight() {
    try {
        const client = getRpcClient();
        const result = await status(client);

        // The jsonrpc-client returns camelCase properties
        if (result?.syncInfo?.latestBlockHeight) {
            return result.syncInfo.latestBlockHeight;
        }
        throw new Error('Could not get current block height');
    } catch (error) {
        console.error('Failed to get current block height:', error);
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

    try {
        await delay(RPC_DELAY_MS);
        const result = await viewAccountRpc(client, params);
        return result;
    } catch (error) {
        // Re-throw with cleaner error message
        if (error.message?.includes('does not exist')) {
            throw new Error(`Account ${accountId} does not exist at block ${blockId}`);
        }
        throw error;
    }
}

/**
 * Get account balance at specific block
 * @param {string} accountId - Account to check
 * @param {number|string} blockId - Block height or 'final'
 * @returns {Promise<string>} Account balance in yoctoNEAR
 */
export async function getAccountBalanceAtBlock(accountId, blockId) {
    try {
        const account = await viewAccount(accountId, blockId);
        return account?.amount || '0';
    } catch (error) {
        // Account might not exist at this block
        const errorStr = error.message?.toLowerCase() || '';
        if (errorStr.includes('does not exist') ||
            errorStr.includes('account_id not found') ||
            errorStr.includes('unknownaccount')) {
            return '0';
        }
        throw error;
    }
}

/**
 * Call view function on a contract
 * @param {string} contractId - Contract ID
 * @param {string} methodName - Method name
 * @param {Object} args - Method arguments
 * @param {number|string} blockId - Block height or 'final'
 */
export async function callViewFunction(contractId, methodName, args, blockId) {
    const client = getRpcClient();

    let argsBase64 = '';
    if (args) {
        const argsString = JSON.stringify(args);
        argsBase64 = Buffer.from(argsString).toString('base64');
    }

    const params = {
        accountId: contractId,
        methodName,
        argsBase64,
        finality: blockId === 'final' ? 'final' : undefined,
        blockId: blockId === 'final' ? undefined : blockId
    };

    try {
        await delay(RPC_DELAY_MS);
        return await viewFunctionAsJson(client, params);
    } catch (error) {
        console.warn(`Failed to call ${methodName} on ${contractId}:`, error.message);
        throw error;
    }
}

/**
 * Get single FT balance
 * @param {string} accountId - Account to check
 * @param {string} contractId - Token contract
 * @param {number|string} blockId - Block height or 'final'
 * @returns {Promise<string>} Token balance
 */
export async function getFTBalance(accountId, contractId, blockId) {
    try {
        const result = await callViewFunction(
            contractId,
            'ft_balance_of',
            { account_id: accountId },
            blockId
        );
        return result || '0';
    } catch (error) {
        // Contract might not have ft_balance_of method
        return '0';
    }
}

/**
 * Get fungible token balances for an account
 * @param {string} accountId - Account to check
 * @param {number|string} blockId - Block height or 'final'
 * @param {string[]} tokenContracts - List of token contracts to check
 * @returns {Promise<Object>} Map of token contract to balance
 */
export async function getFungibleTokenBalances(accountId, blockId, tokenContracts = undefined) {
    const balances = {};

    // Default popular tokens
    if (tokenContracts === undefined) {
        tokenContracts = [
            '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',  // USDC
            'wrap.near'
        ];
    }

    if (tokenContracts.length === 0) {
        return null;
    }


    console.log("checking", blockId, tokenContracts);
    // Fetch balances sequentially to avoid rate limits
    for (const contractId of tokenContracts) {
        try {
            const balance = await getFTBalance(accountId, contractId, blockId);
            if (balance !== '0') {
                balances[contractId] = balance;
            }
        } catch (error) {
            console.warn(`Failed to get balance for ${contractId}:`, error.message);
        }
    }

    return balances;
}

/**
 * Get intents balances for an account
 * @param {string} accountId - Account to check
 * @param {number|string} blockId - Block height or 'final'
 * @returns {Promise<Object>} Intents positions with token metadata
 */
export async function getIntentsBalances(accountId, blockId, tokenIds = undefined) {
    // If no specific tokens provided, get all tokens owned by the account
    if (!tokenIds) {
        console.log("getIntentsBalances - fetching tokens for", accountId, "at block", blockId);
        const tokens = await callViewFunction(
            'intents.near',
            'mt_tokens_for_owner',
            {
                account_id: accountId
            },
            blockId
        );

        console.log("getIntentsBalances - tokens found:", tokens?.length || 0);
        if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
            return {};
        }

        tokenIds = tokens.map(token => token.token_id);
    }

    // If we still have no tokens, return empty
    if (!tokenIds || tokenIds.length === 0) {
        return {};
    }

    console.log("checking", blockId, tokenIds);
    // Get the balances for these token IDs
    const balances = await callViewFunction(
        'intents.near',
        'mt_batch_balance_of',
        {
            account_id: accountId,
            token_ids: tokenIds
        },
        blockId
    );

    // Structure the intents data
    const intents = {};
    if (Array.isArray(balances)) {
        tokenIds.forEach((tokenId, index) => {
            const balance = balances[index];
            if (balance && balance !== '0') {
                intents[tokenId] = {
                    balance: balance
                };
            }
        });
    }

    return intents;
}

/**
 * Get all balances (NEAR, FTs, Intents) at a specific block
 * @param {string} accountId - Account to check
 * @param {number|string} blockId - Block height or 'final'
 * @param {string[]} tokenContracts - Optional list of token contracts
 * @param {string[]} intentsTokens - Optional list of intents token IDs to check
 * @param {boolean} checkNear - Whether to check NEAR balance (default true)
 * @returns {Promise<Object>} All balances
 */
export async function getAllBalances(accountId, blockId, tokenContracts = undefined, intentsTokens = undefined, checkNear = true) {
    console.log("getAllBalances", blockId, "tokenContracts:", tokenContracts, "intentsTokens:", intentsTokens, "checkNear:", checkNear);
    // Fetch sequentially to avoid rate limits
    const near = checkNear ? await getAccountBalanceAtBlock(accountId, blockId) : null;
    const fungibleTokens = tokenContracts !== null ? await getFungibleTokenBalances(accountId, blockId, tokenContracts) : null;
    const intents = intentsTokens !== null ? await getIntentsBalances(accountId, blockId, intentsTokens) : null;

    return {
        near,
        fungibleTokens,
        intents,
        blockId
    };
}

/**
 * Detect balance changes between two snapshots
 * @param {Object} balance1 - First balance snapshot
 * @param {Object} balance2 - Second balance snapshot
 * @returns {Object} Detected changes
 */
export function detectBalanceChanges(balance1, balance2) {
    const changes = {
        nearChanged: balance1.near !== balance2.near,
        tokensChanged: {},
        intentsChanged: {},
        hasChanges: false
    };

    // Check NEAR balance - compare the actual amounts, not the objects
    // Skip if NEAR wasn't checked (null values)
    if (balance1.near !== null && balance2.near !== null) {
        const near1 = typeof balance1.near === 'object' ? balance1.near.amount : balance1.near;
        const near2 = typeof balance2.near === 'object' ? balance2.near.amount : balance2.near;

        if (near1 !== near2) {
            const nearDiff = BigInt(near2) - BigInt(near1);
            // Only mark as changed if there's an actual difference
            if (nearDiff !== 0n) {
                changes.nearChanged = true;
                changes.hasChanges = true;
                changes.nearDiff = nearDiff;
            }
        }
    }

    // Check fungible token balances (skip if null, which means we're not checking tokens)
    if (balance1.fungibleTokens !== null || balance2.fungibleTokens !== null) {
        const allTokens = new Set([
            ...Object.keys(balance1.fungibleTokens || {}),
            ...Object.keys(balance2.fungibleTokens || {})
        ]);

        for (const token of allTokens) {
            const balance1Token = balance1.fungibleTokens?.[token] || '0';
            const balance2Token = balance2.fungibleTokens?.[token] || '0';

            if (balance1Token !== balance2Token) {
                // Ensure we're working with string values
                const val1 = typeof balance1Token === 'object' ? (balance1Token.amount || '0') : balance1Token;
                const val2 = typeof balance2Token === 'object' ? (balance2Token.amount || '0') : balance2Token;

                const diff = BigInt(val2) - BigInt(val1);

                // Only record if there's an actual change (diff != 0)
                if (diff !== 0n) {
                    changes.tokensChanged[token] = {
                        before: val1,
                        after: val2,
                        diff: diff
                    };
                    changes.hasChanges = true;
                }
            }
        }
    }

    // Check intents balances
    const allIntentTokens = new Set([
        ...Object.keys(balance1.intents || {}),
        ...Object.keys(balance2.intents || {})
    ]);

    for (const token of allIntentTokens) {
        const intent1 = balance1.intents?.[token];
        const intent2 = balance2.intents?.[token];

        const balance1Value = intent1?.balance || '0';
        const balance2Value = intent2?.balance || '0';

        if (balance1Value !== balance2Value) {
            const diff = BigInt(balance2Value) - BigInt(balance1Value);

            // Only record if there's an actual change (diff != 0)
            if (diff !== 0n) {
                changes.intentsChanged[token] = {
                    before: intent1,
                    after: intent2,
                    diff: diff
                };
                changes.hasChanges = true;
            }
        }
    }

    return changes;
}

/**
 * Find the latest balance change transaction before a specified block
 * @param {string} accountId - Account to check
 * @param {number} firstBlock - Start block height (moving boundary)
 * @param {number} lastBlock - End block height (fixed)
 * @param {string[]} tokenContracts - Optional list of token contracts to check
 * @param {string[]} intentsTokens - Optional list of intents tokens to check (for optimization)
 * @param {boolean} checkNear - Whether to check NEAR balance (for optimization)
 * @returns {Promise<Object|null>} Balance change object with exact block or null if no changes
 */
export async function findLatestBalanceChangeTransaction(accountId, firstBlock, lastBlock, tokenContracts = undefined, intentsTokens = undefined, checkNear = true) {
    const numBlocks = lastBlock-firstBlock;
    console.log("findLatestBalanceChangeTransaction", firstBlock, numBlocks, tokenContracts, intentsTokens, checkNear);

    // Get balances at start and end blocks
    const startBalance = await getAllBalances(accountId, firstBlock, tokenContracts, intentsTokens, checkNear);
    const endBalance = await getAllBalances(accountId, lastBlock, tokenContracts, intentsTokens, checkNear);

    // Detect what changed
    const detectedChanges = detectBalanceChanges(startBalance, endBalance);

    if (!detectedChanges.hasChanges || numBlocks === 1) {
        detectedChanges.block = firstBlock;
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
    // If no tokens changed, pass null to skip checking
    const lastHalfChanges = await findLatestBalanceChangeTransaction(
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
        return await findLatestBalanceChangeTransaction(
            accountId,
            firstBlock,
            middleBlock,
            changedTokens.length > 0 ? changedTokens : null,
            changedIntentsTokens.length > 0 ? changedIntentsTokens : null,
            nearChanged  // Only check NEAR if it changed in outer call
        );
    }
}

// Keep the old function as a wrapper that finds all changes in a range
export async function findBalanceChanges(accountId, startBlock, endBlock, tokenContracts = []) {
    const changes = [];
    let currentStart = startBlock;

    while (currentStart < endBlock) {
        const change = await findLatestBalanceChangeTransaction(accountId, currentStart, endBlock, tokenContracts);

        if (change) {
            changes.push(change);
            // Move past this change to find the next one
            currentStart = change.block + 1;
        } else {
            // No more changes found
            break;
        }
    }

    return changes;
}