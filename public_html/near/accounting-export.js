// Fetch transaction history from the accounting export API
// This provides pre-computed balance history without needing client-side balance tracking

import { getCachedTokenMetadata, cacheTokenMetadata } from '../storage/token-metadata-cache.js';
import { fetchFtMetadata } from './rpc.js';

const ACCOUNTING_EXPORT_API_BASE = 'https://near-accounting-export.fly.dev/api';
const INTENTS_TOKENS_API = 'https://1click.chaindefuser.com/v0/tokens';

// Cache for intents token metadata
let intentsTokenCache = null;

// In-memory cache for token metadata fetched during this session
// Keyed by contract ID, values are {symbol, decimals}
const sessionTokenMetadataCache = new Map();

/**
 * Fetch and cache intents token metadata from the API
 * @returns {Promise<Map<string, {symbol: string, decimals: number}>>}
 */
async function getIntentsTokenMetadata() {
    if (intentsTokenCache) {
        return intentsTokenCache;
    }
    
    try {
        const response = await fetch(INTENTS_TOKENS_API);
        if (!response.ok) {
            console.warn('Failed to fetch intents token metadata, using fallback');
            return new Map();
        }
        
        const tokens = await response.json();
        intentsTokenCache = new Map();
        
        for (const token of tokens) {
            // Store by assetId (e.g., "nep141:eth.omft.near")
            intentsTokenCache.set(token.assetId, {
                symbol: token.symbol,
                decimals: token.decimals
            });
            
            // Also store by contract address without prefix for legacy lookups
            // Extract contract address from assetId (e.g., "nep141:eth.omft.near" -> "eth.omft.near")
            const contractAddress = token.assetId?.replace(/^nep1[43][15]:/, '');
            if (contractAddress && contractAddress !== token.assetId) {
                intentsTokenCache.set(contractAddress, {
                    symbol: token.symbol,
                    decimals: token.decimals
                });
            }
        }
        
        return intentsTokenCache;
    } catch (e) {
        console.warn('Error fetching intents token metadata:', e);
        return new Map();
    }
}

/**
 * Fetch JSON data from accounting export API
 * @param {string} accountId - NEAR account ID
 * @returns {Promise<Object>} Parsed JSON response
 */
export async function fetchAccountingExportJSON(accountId) {
    const url = `${ACCOUNTING_EXPORT_API_BASE}/accounts/${accountId}/download/json`;
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Failed to fetch accounting data: ${response.status} ${response.statusText}`);
    }

    return await response.json();
}

/**
 * Convert a JSON transaction entry to NEAR transaction format
 * @param {Object} entry - Transaction entry from JSON API
 * @param {string} accountId - Account ID
 * @returns {Object|null} Transaction in existing format, or null if no NEAR transfers
 */
function convertToNearTransaction(entry, accountId) {
    // Find NEAR transfers
    const nearTransfers = entry.transfers.filter(t => t.type === 'near');
    if (nearTransfers.length === 0) return null;

    // Calculate total NEAR change
    let totalChange = 0n;
    for (const transfer of nearTransfers) {
        const amount = BigInt(transfer.amount || '0');
        totalChange += transfer.direction === 'in' ? amount : -amount;
    }

    // Find the main counterparty (non-system)
    let counterparty = '';
    for (const transfer of nearTransfers) {
        if (transfer.counterparty && transfer.counterparty !== 'system') {
            counterparty = transfer.counterparty;
            break;
        }
    }

    // Get transaction details if available
    const txDetails = entry.transactions?.[0];
    const action = txDetails?.actions?.[0];
    const functionCall = action?.FunctionCall;

    // Determine action kind
    let actionKind = 'TRANSFER';
    let methodName = '';
    if (functionCall) {
        actionKind = 'FUNCTION_CALL';
        methodName = functionCall.method_name || '';
    } else if (action?.Transfer) {
        actionKind = 'TRANSFER';
    } else if (action?.Stake) {
        actionKind = 'STAKE';
    }

    // Get transaction hash
    const hash = entry.transactionHashes?.[0] || `block-${entry.block}`;

    return {
        hash,
        block_height: entry.block,
        block_timestamp: entry.timestamp.toString(),
        signer_id: txDetails?.signerId || accountId,
        receiver_id: txDetails?.receiverId || counterparty,
        balance: entry.balanceAfter?.near || '0',
        action_kind: actionKind,
        args: functionCall ? {
            method_name: functionCall.method_name,
            deposit: functionCall.deposit,
            gas: functionCall.gas
        } : {},
        _source: 'accounting-export',
        _near_change: totalChange.toString()
    };
}

/**
 * Convert fungible token transfer to FT transaction format
 * @param {Object} transfer - Transfer object from JSON API
 * @param {Object} entry - Parent transaction entry
 * @param {string} accountId - Account ID
 * @param {Map} tokenMetadata - Token metadata from intents API
 * @returns {Object} Fungible token transaction
 */
function convertToFungibleTokenTransaction(transfer, entry, accountId, tokenMetadata, runningFungibleBalances = {}, runningIntentsBalances = {}) {
    const isIncoming = transfer.direction === 'in';
    const amount = BigInt(transfer.amount || '0');
    const deltaAmount = isIncoming ? amount.toString() : (-amount).toString();

    // Get contract ID from tokenId field
    const contractId = transfer.tokenId || transfer.counterparty || '';

    // Get balance from running accumulated state (handles sparse balance data correctly)
    // The API returns sparse balances - only tokens that changed are present in each entry
    // The running balances are accumulated as we process entries in chronological order
    const balance = runningFungibleBalances[contractId] || runningIntentsBalances[contractId] || '0';

    // Map known contract addresses to symbols (using API metadata when available)
    const symbol = getTokenSymbol(contractId, tokenMetadata) || contractId.split('.')[0].toUpperCase();

    // Get decimals (using API metadata when available)
    // Fall back to 24 only if metadata couldn't be fetched (shouldn't happen after prefetch)
    const decimals = getTokenDecimals(contractId, tokenMetadata) ?? 24;

    return {
        transaction_hash: entry.transactionHashes?.[0] || `block-${entry.block}`,
        block_height: entry.block,
        block_timestamp: entry.timestamp.toString(),
        account_id: accountId,
        delta_amount: deltaAmount,
        involved_account_id: transfer.counterparty || '',
        balance,
        ft: {
            contract_id: contractId,
            symbol,
            decimals
        },
        args: {},
        _source: 'accounting-export',
        _receiptId: transfer.receiptId
    };
}

/**
 * Get token symbol from contract ID (supports both regular FTs and intents tokens)
 * Uses cached metadata from intents API when available
 * Returns raw symbol - use getDisplaySymbol() to add NEAR Intents prefix for display
 */
function getTokenSymbol(contractId, tokenMetadata) {
    // Check intents token cache first (with original ID including prefix)
    if (tokenMetadata?.has(contractId)) {
        return tokenMetadata.get(contractId).symbol;
    }

    // Strip nep141:/nep245: prefix if present (intents tokens)
    const normalizedId = contractId.replace(/^nep1[43][15]:/, '');

    // Check cache with normalized ID
    if (tokenMetadata?.has(normalizedId)) {
        return tokenMetadata.get(normalizedId).symbol;
    }

    // Check session cache (populated from git storage or RPC)
    if (sessionTokenMetadataCache.has(normalizedId)) {
        return sessionTokenMetadataCache.get(normalizedId).symbol;
    }

    return undefined;
}

/**
 * Get token decimals from contract ID (supports both regular FTs and intents tokens)
 * Uses cached metadata from intents API when available
 */
function getTokenDecimals(contractId, tokenMetadata) {
    // Check intents token cache first (with original ID including prefix)
    if (tokenMetadata?.has(contractId)) {
        return tokenMetadata.get(contractId).decimals;
    }

    // Strip nep141:/nep245: prefix if present (intents tokens)
    const normalizedId = contractId.replace(/^nep1[43][15]:/, '');

    // Check cache with normalized ID
    if (tokenMetadata?.has(normalizedId)) {
        return tokenMetadata.get(normalizedId).decimals;
    }

    // Check session cache (populated from git storage or RPC)
    if (sessionTokenMetadataCache.has(normalizedId)) {
        return sessionTokenMetadataCache.get(normalizedId).decimals;
    }

    // Return undefined to signal that metadata needs to be fetched
    return undefined;
}

/**
 * Fetch and cache token metadata for a contract ID
 * Checks git storage first, then fetches from RPC if not found
 * @param {string} contractId - Token contract ID (may include nep141: prefix)
 * @returns {Promise<{symbol: string, decimals: number}|null>}
 */
async function fetchAndCacheTokenMetadata(contractId) {
    // Strip nep141:/nep245: prefix if present
    const normalizedId = contractId.replace(/^nep1[43][15]:/, '');

    // Check session cache first
    if (sessionTokenMetadataCache.has(normalizedId)) {
        return sessionTokenMetadataCache.get(normalizedId);
    }

    // Check git storage cache
    const cachedMetadata = await getCachedTokenMetadata(normalizedId);
    if (cachedMetadata) {
        sessionTokenMetadataCache.set(normalizedId, cachedMetadata);
        return cachedMetadata;
    }

    // Fetch from RPC
    console.log(`Fetching ft_metadata for ${normalizedId}...`);
    const ftMetadata = await fetchFtMetadata(normalizedId);
    if (ftMetadata) {
        const metadata = {
            symbol: ftMetadata.symbol,
            decimals: ftMetadata.decimals,
            name: ftMetadata.name
        };
        // Cache in session
        sessionTokenMetadataCache.set(normalizedId, metadata);
        // Cache in git storage
        await cacheTokenMetadata(normalizedId, metadata);
        console.log(`Cached metadata for ${normalizedId}: ${metadata.symbol}, ${metadata.decimals} decimals`);
        return metadata;
    }

    return null;
}

/**
 * Pre-fetch metadata for all unique token contract IDs
 * @param {Array<Object>} entries - Transaction entries
 * @param {Map} intentsMetadata - Already loaded intents token metadata
 */
async function prefetchTokenMetadata(entries, intentsMetadata) {
    // Collect unique contract IDs that need metadata
    const contractIds = new Set();

    for (const entry of entries) {
        for (const transfer of entry.transfers) {
            if (transfer.type === 'ft' || transfer.type === 'mt') {
                const contractId = transfer.tokenId || transfer.counterparty || '';
                const normalizedId = contractId.replace(/^nep1[43][15]:/, '');

                // Skip if already in intents metadata
                if (intentsMetadata?.has(contractId) || intentsMetadata?.has(normalizedId)) {
                    continue;
                }

                // Skip if already in session cache
                if (sessionTokenMetadataCache.has(normalizedId)) {
                    continue;
                }

                if (normalizedId) {
                    contractIds.add(normalizedId);
                }
            }
        }
    }

    // Fetch metadata for each unique contract ID
    for (const contractId of contractIds) {
        await fetchAndCacheTokenMetadata(contractId);
    }
}

/**
 * Extract staking data from JSON entries
 * Creates time-series of staking balances per pool
 * @param {Array<Object>} entries - Transaction entries from JSON API
 * @returns {Map<string, Array<Object>>} Staking data by pool ID
 */
function extractStakingData(entries) {
    const stakingDataByPool = new Map();

    for (const entry of entries) {
        const stakingPools = entry.balanceAfter?.stakingPools || {};
        const stakingChanges = entry.changes?.stakingChanged || {};

        // Process each pool that has a balance or changed
        const allPools = new Set([
            ...Object.keys(stakingPools),
            ...Object.keys(stakingChanges)
        ]);

        for (const poolId of allPools) {
            const balance = BigInt(stakingPools[poolId] || '0');
            if (balance === 0n && !stakingChanges[poolId]) continue;

            if (!stakingDataByPool.has(poolId)) {
                stakingDataByPool.set(poolId, []);
            }

            // Determine deposit/withdrawal from staking transfers
            let deposit = 0;
            let withdrawal = 0;
            let isStakingReward = false;

            for (const transfer of entry.transfers) {
                if (transfer.type === 'staking_reward' && transfer.tokenId === poolId) {
                    isStakingReward = true;
                } else if (transfer.counterparty === poolId) {
                    const amount = Number(BigInt(transfer.amount || '0'));
                    if (transfer.direction === 'out') {
                        deposit += amount; // Sending NEAR to pool = deposit
                    } else if (transfer.direction === 'in' && transfer.memo !== 'staking_reward') {
                        withdrawal += amount; // Receiving from pool = withdrawal
                    }
                }
            }

            // Also check for deposit_and_stake or unstake method calls
            for (const tx of entry.transactions || []) {
                if (tx.receiverId === poolId) {
                    const action = tx.actions?.[0];
                    if (action?.FunctionCall) {
                        const method = action.FunctionCall.method_name;
                        const depositAmount = BigInt(action.FunctionCall.deposit || '0');
                        if (method === 'deposit_and_stake' && depositAmount > 0n) {
                            deposit = Number(depositAmount);
                        }
                    }
                }
            }

            const stakingEntry = {
                timestamp: new Date(Number(entry.timestamp) / 1_000_000).toISOString(), // Convert nanoseconds to ISO string
                balance: Number(balance),
                block_height: entry.block,
                deposit,
                withdrawal,
                earnings: 0, // Will be calculated after sorting
                _source: 'accounting-export',
                _isStakingReward: isStakingReward
            };

            if (entry.transactionHashes?.length > 0) {
                stakingEntry.hash = entry.transactionHashes[0];
            }

            stakingDataByPool.get(poolId).push(stakingEntry);
        }
    }

    // Sort and calculate earnings for each pool
    for (const [poolId, entries] of stakingDataByPool) {
        // Sort by block height descending (newest first)
        entries.sort((a, b) => b.block_height - a.block_height);

        // Calculate earnings: balance_change - deposits + withdrawals
        for (let i = 0; i < entries.length - 1; i++) {
            const current = entries[i];
            const previous = entries[i + 1];
            current.earnings = current.balance - previous.balance - current.deposit + current.withdrawal;
        }
        // First staking entry has no previous, so earnings = 0
        if (entries.length > 0) {
            entries[entries.length - 1].earnings = 0;
        }
    }

    return stakingDataByPool;
}

/**
 * Convert accounting export JSON to transaction formats used by this app
 * @param {string} accountId - NEAR account ID
 * @param {Object} jsonData - Parsed JSON from API
 * @returns {Promise<Object>} Object with transactions, ftTransactions, and stakingData
 */
export async function convertAccountingExportToTransactions(accountId, jsonData) {
    const entries = jsonData.transactions || [];
    const transactions = [];
    const ftTransactions = [];
    const processedHashes = new Set();

    // Fetch intents token metadata for symbol/decimals resolution
    const tokenMetadata = await getIntentsTokenMetadata();

    // Pre-fetch metadata for all tokens not in intents API (from cache or RPC)
    await prefetchTokenMetadata(entries, tokenMetadata);

    // Running balance state for sparse balance reconstruction
    // The API returns sparse balances - only tokens that changed are present in balanceAfter
    // We need to track cumulative state to know the actual balance after each entry
    const runningFungibleBalances = {};
    const runningIntentsBalances = {};
    // Track tokens that have API-provided balance data vs computed from transfers
    const tokensWithApiBalance = new Set();

    // Sort entries by block height ascending to process in chronological order
    // This allows us to accumulate balances correctly
    const sortedEntries = [...entries].sort((a, b) => a.block - b.block);

    for (const entry of sortedEntries) {
        // Update running balance state from this entry's sparse balance data
        const afterFt = entry.balanceAfter?.fungibleTokens || {};
        const afterIntents = entry.balanceAfter?.intentsTokens || {};

        for (const [token, balance] of Object.entries(afterFt)) {
            runningFungibleBalances[token] = balance;
            tokensWithApiBalance.add(token);
        }
        for (const [token, balance] of Object.entries(afterIntents)) {
            runningIntentsBalances[token] = balance;
            tokensWithApiBalance.add(token);
        }

        // Process NEAR transactions
        const nearTx = convertToNearTransaction(entry, accountId);
        if (nearTx && !processedHashes.has(nearTx.hash)) {
            transactions.push(nearTx);
            processedHashes.add(nearTx.hash);
        }

        // Process fungible token transfers (both regular FT and intents/multi-token)
        // We need to compute balance from transfers for tokens not tracked in balanceAfter
        for (const transfer of entry.transfers) {
            if (transfer.type === 'ft' || transfer.type === 'mt') {
                const contractId = transfer.tokenId || transfer.counterparty || '';
                const isIncoming = transfer.direction === 'in';
                const amount = BigInt(transfer.amount || '0');

                // If API doesn't provide balance data for this token, compute from transfers
                if (!tokensWithApiBalance.has(contractId)) {
                    // Initialize computed balance if not exists
                    if (!runningFungibleBalances[contractId]) {
                        runningFungibleBalances[contractId] = '0';
                    }
                    // Update computed balance based on transfer direction
                    const currentBalance = BigInt(runningFungibleBalances[contractId]);
                    const newBalance = isIncoming ? currentBalance + amount : currentBalance - amount;
                    runningFungibleBalances[contractId] = newBalance.toString();
                }

                ftTransactions.push(convertToFungibleTokenTransaction(
                    transfer, entry, accountId, tokenMetadata,
                    runningFungibleBalances, runningIntentsBalances
                ));
            }
        }
    }

    // Extract staking data from balance snapshots
    const stakingData = extractStakingData(entries);

    // Sort by block height descending (newest first)
    transactions.sort((a, b) => b.block_height - a.block_height);
    ftTransactions.sort((a, b) => b.block_height - a.block_height);

    return { transactions, ftTransactions, stakingData };
}

/**
 * Fetch and convert accounting export to app transaction format
 * Main entry point for this module
 * @param {string} accountId - NEAR account ID
 * @returns {Promise<Object>} Object with transactions, ftTransactions, and stakingData
 */
export async function fetchAndConvertAccountingExport(accountId) {
    const jsonData = await fetchAccountingExportJSON(accountId);
    return await convertAccountingExportToTransactions(accountId, jsonData);
}

/**
 * Merge accounting export data with existing transactions
 * Accounting export data takes precedence for overlapping transactions
 * @param {Array<Object>} existingTransactions - Existing transactions
 * @param {Array<Object>} newTransactions - Transactions from accounting export
 * @returns {Array<Object>} Merged and sorted transactions
 */
export function mergeTransactions(existingTransactions, newTransactions) {
    // Create map of existing transactions by hash
    const existingByHash = new Map();
    for (const tx of existingTransactions) {
        existingByHash.set(tx.hash, tx);
    }

    // Add or update with new transactions
    for (const tx of newTransactions) {
        existingByHash.set(tx.hash, tx);
    }

    // Convert back to array and sort by block height descending
    const merged = Array.from(existingByHash.values());
    merged.sort((a, b) => b.block_height - a.block_height);

    return merged;
}

/**
 * Merge fungible token transactions
 * @param {Array<Object>} existingFtTx - Existing FT transactions
 * @param {Array<Object>} newFtTx - FT transactions from accounting export
 * @returns {Array<Object>} Merged and sorted FT transactions
 */
export function mergeFungibleTokenTransactions(existingFtTx, newFtTx) {
    // Create map using transaction_hash + contract_id as key
    const existingByKey = new Map();
    for (const tx of existingFtTx) {
        const key = `${tx.transaction_hash}-${tx.ft.contract_id}`;
        existingByKey.set(key, tx);
    }

    // Add or update with new transactions
    // Keep the transaction with the highest block_height when there are duplicates
    for (const tx of newFtTx) {
        const key = `${tx.transaction_hash}-${tx.ft.contract_id}`;
        const existing = existingByKey.get(key);
        if (!existing || tx.block_height > existing.block_height) {
            existingByKey.set(key, tx);
        }
    }

    // Convert back to array and sort by block height descending
    const merged = Array.from(existingByKey.values());
    merged.sort((a, b) => b.block_height - a.block_height);

    return merged;
}

/**
 * Merge staking data entries for a single pool
 * @param {Array<Object>} existingEntries - Existing staking entries
 * @param {Array<Object>} newEntries - New staking entries from accounting export
 * @returns {Array<Object>} Merged and sorted staking entries
 */
export function mergeStakingEntries(existingEntries, newEntries) {
    // Create map using block_height as key (unique per staking snapshot)
    const entriesByBlock = new Map();

    for (const entry of existingEntries) {
        entriesByBlock.set(entry.block_height, entry);
    }

    // New entries take precedence
    for (const entry of newEntries) {
        entriesByBlock.set(entry.block_height, entry);
    }

    // Convert back to array and sort by block height descending
    const merged = Array.from(entriesByBlock.values());
    merged.sort((a, b) => b.block_height - a.block_height);

    // Recalculate earnings after merge
    for (let i = 0; i < merged.length - 1; i++) {
        const current = merged[i];
        const previous = merged[i + 1];
        current.earnings = current.balance - previous.balance - (current.deposit || 0) + (current.withdrawal || 0);
    }
    if (merged.length > 0) {
        merged[merged.length - 1].earnings = 0;
    }

    return merged;
}
