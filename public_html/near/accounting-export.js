// Fetch transaction history from the accounting export API
// This provides pre-computed balance history without needing client-side balance tracking

import { getCachedTokenMetadata, cacheTokenMetadata } from '../storage/token-metadata-cache.js';
import { fetchFtMetadata } from './rpc.js';
import { getIntentsTokenMetadata } from './intents-tokens.js';
import { arizgatewayhost, isSignedIn, getAccessToken } from '../arizgateway/arizgatewayaccess.js';

// In-memory cache for token metadata fetched during this session
// Keyed by contract ID, values are {symbol, decimals}
const sessionTokenMetadataCache = new Map();

/**
 * Detect if data is in V2 format
 * @param {Object} data - Parsed JSON from API
 * @returns {boolean} True if V2 format
 */
export function isV2Format(data) {
    return data.version === 2 && Array.isArray(data.records);
}

/**
 * Check if a token ID represents a staking pool
 * @param {string} tokenId - Token ID
 * @returns {boolean} True if staking pool
 */
function isStakingPool(tokenId) {
    return tokenId.includes('.poolv1.near') ||
           tokenId.includes('.pool.near') ||
           tokenId.endsWith('.pool.f863973.m0');
}

/**
 * Get transfer type from token ID
 * @param {string} tokenId - Token ID
 * @returns {string} Transfer type ('near', 'mt', 'staking_reward', or 'ft')
 */
function getTransferType(tokenId) {
    if (tokenId === 'near') return 'near';
    if (tokenId.startsWith('nep141:') || tokenId.startsWith('nep245:')) return 'mt';
    if (isStakingPool(tokenId)) return 'staking_reward';
    return 'ft';
}

/**
 * Convert a block's V2 records to a V1-like entry
 * @param {number} block - Block height
 * @param {Array<Object>} records - V2 records for this block
 * @returns {Object} V1-like entry
 */
function convertBlockRecordsToEntry(block, records) {
    const firstRecord = records[0];
    const timestamp = firstRecord.block_timestamp
        ? new Date(firstRecord.block_timestamp).getTime() * 1_000_000  // Convert to nanoseconds
        : null;

    // Build transfers array
    const transfers = records.map(r => ({
        type: getTransferType(r.token_id),
        direction: BigInt(r.amount) >= 0n ? 'in' : 'out',
        amount: r.amount.replace(/^-/, ''),  // Absolute value
        counterparty: r.counterparty || '',
        tokenId: r.token_id === 'near' ? undefined : r.token_id,
        receiptId: r.receipt_id,
        txHash: r.tx_hash,
        memo: r.memo
    }));

    // Build balance snapshots
    const balanceBefore = { fungibleTokens: {}, intentsTokens: {}, stakingPools: {} };
    const balanceAfter = { fungibleTokens: {}, intentsTokens: {}, stakingPools: {} };

    for (const r of records) {
        if (r.token_id === 'near') {
            balanceBefore.near = r.balance_before;
            balanceAfter.near = r.balance_after;
        } else if (r.token_id.startsWith('nep141:') || r.token_id.startsWith('nep245:')) {
            balanceBefore.intentsTokens[r.token_id] = r.balance_before;
            balanceAfter.intentsTokens[r.token_id] = r.balance_after;
        } else if (isStakingPool(r.token_id)) {
            balanceBefore.stakingPools[r.token_id] = r.balance_before;
            balanceAfter.stakingPools[r.token_id] = r.balance_after;
        } else {
            balanceBefore.fungibleTokens[r.token_id] = r.balance_before;
            balanceAfter.fungibleTokens[r.token_id] = r.balance_after;
        }
    }

    // Build changes object
    const changes = {
        nearChanged: false,
        tokensChanged: {},
        intentsChanged: {},
        stakingChanged: {}
    };

    for (const r of records) {
        const diff = r.amount;

        if (r.token_id === 'near') {
            changes.nearChanged = true;
            changes.nearDiff = diff;
        } else if (r.token_id.startsWith('nep141:') || r.token_id.startsWith('nep245:')) {
            changes.intentsChanged[r.token_id] = {
                start: r.balance_before,
                end: r.balance_after,
                diff
            };
        } else if (isStakingPool(r.token_id)) {
            changes.stakingChanged[r.token_id] = {
                start: r.balance_before,
                end: r.balance_after,
                diff
            };
        } else {
            changes.tokensChanged[r.token_id] = {
                start: r.balance_before,
                end: r.balance_after,
                diff
            };
        }
    }

    // Collect unique transaction hashes
    const txHashes = [...new Set(records.map(r => r.tx_hash).filter(Boolean))];

    return {
        block,
        transactionBlock: firstRecord.tx_block,
        timestamp,
        transactionHashes: txHashes,
        transactions: [],  // V2 doesn't include full transaction details
        transfers,
        balanceBefore,
        balanceAfter,
        changes
    };
}

/**
 * Convert V2 format data to V1-like internal format
 * Groups records by block_height into entries with transfers and balance snapshots
 * @param {Object} v2Data - V2 format data from API
 * @returns {Object} V1-like internal format
 */
export function convertV2ToInternalFormat(v2Data) {
    const entries = [];

    // Group records by block_height
    const byBlock = new Map();
    for (const record of v2Data.records) {
        const block = record.block_height;
        if (!byBlock.has(block)) {
            byBlock.set(block, []);
        }
        byBlock.get(block).push(record);
    }

    // Convert each block's records to V1-like entry
    for (const [block, records] of byBlock) {
        const entry = convertBlockRecordsToEntry(block, records);
        entries.push(entry);
    }

    return {
        accountId: v2Data.accountId,
        transactions: entries.sort((a, b) => a.block - b.block),
        metadata: {
            ...v2Data.metadata,
            totalTransactions: entries.length
        }
    };
}

/**
 * Fetch JSON data from accounting export API
 * @param {string} accountId - NEAR account ID
 * @returns {Promise<Object>} Parsed JSON response
 */
/**
 * Fetch the raw response from the accounting-export gateway. For V2 data this
 * is the flat BalanceChangeRecord shape: { version, accountId, metadata,
 * records: [...] }. For pre-V2 data it's the legacy entries-grouped-by-block
 * shape. Used directly by the storage layer to persist records.json — callers
 * that want the V1-like internal format should use fetchAccountingExportJSON.
 */
export async function fetchRawAccountingExport(accountId) {
    // Always make the fetch (so test mocks intercept regardless of auth state).
    // Add the bearer token if signed in; the gateway will 401 anonymous requests
    // in production, while test mocks bypass auth entirely.
    const headers = {};
    if (await isSignedIn()) {
        headers['authorization'] = `Bearer ${await getAccessToken()}`;
    }

    const url = `${arizgatewayhost}/api/accounting/${encodeURIComponent(accountId)}/download/json`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch accounting data: ${response.status} ${response.statusText}: ${errorText}`);
    }
    const data = await response.json();

    // Sanity-check that the gateway returned data for the account we asked for.
    if (data.accountId && data.accountId !== accountId) {
        throw new Error(`Gateway returned data for ${data.accountId} but ${accountId} was requested`);
    }

    return data;
}

export async function fetchAccountingExportJSON(accountId) {
    const data = await fetchRawAccountingExport(accountId);

    // Convert V2 format to V1-like internal format
    if (isV2Format(data)) {
        return convertV2ToInternalFormat(data);
    }

    return data;
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
    if (functionCall) {
        actionKind = 'FUNCTION_CALL';
    } else if (action?.Transfer) {
        actionKind = 'TRANSFER';
    } else if (action?.Stake) {
        actionKind = 'STAKE';
    }

    // Get transaction hash
    const hash = entry.transactionHashes?.[0] || `block-${entry.block}`;

    // Determine who sent/received the tokens. The counterparty field indicates
    // who the tokens came from (incoming) or went to (outgoing).
    // For V2 format (no transaction details), use counterparty for incoming transfers
    // to properly classify external income vs own-account activity.
    const signerId = txDetails?.signerId
        || (totalChange > 0n && counterparty ? counterparty : accountId);

    return {
        hash,
        block_height: entry.block,
        block_timestamp: entry.timestamp.toString(),
        signer_id: signerId,
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
 * @param {Object} runningFungibleBalances - Running balance state for sparse FT data
 * @param {Object} runningIntentsBalances - Running balance state for sparse intents data
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
    const normalizedId = contractId.replace(/^nep(141|245):/, '');

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
    const normalizedId = contractId.replace(/^nep(141|245):/, '');

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
    const normalizedId = contractId.replace(/^nep(141|245):/, '');

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
                const normalizedId = contractId.replace(/^nep(141|245):/, '');

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
    // Track seen transaction hashes per pool to avoid duplicates
    const seenTxHashesByPool = new Map();

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

            // Check if there are any transfers for this pool in the current entry
            const hasTransfersForPool = entry.transfers?.some(t =>
                t.counterparty === poolId || t.tokenId === poolId
            );

            // Skip balance=0 entries that have no transfers for this pool
            // These are typically daily snapshots that incorrectly show balance=0
            // when the actual balance is non-zero
            if (balance === 0n && !hasTransfersForPool) continue;

            // Get txHash for deduplication
            const txHash = entry.transactionHashes?.[0];

            // Skip if we've already seen this txHash for this pool (avoid duplicate entries)
            if (txHash) {
                if (!seenTxHashesByPool.has(poolId)) {
                    seenTxHashesByPool.set(poolId, new Set());
                }
                if (seenTxHashesByPool.get(poolId).has(txHash)) {
                    continue;  // Skip duplicate
                }
                seenTxHashesByPool.get(poolId).add(txHash);
            }

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

            // Use the staking_reward transfer amount as earnings, but only for actual
            // epoch rewards (no tx_hash). In V2 format, all staking pool records get
            // type='staking_reward', so we must exclude deposit/withdrawal transactions
            // which have a tx_hash set.
            let earnings = 0;
            const stakingRewardTransfer = entry.transfers.find(
                t => t.type === 'staking_reward' && (t.tokenId === poolId || t.counterparty === poolId)
                    && !t.txHash
            );
            if (stakingRewardTransfer) {
                earnings = Number(BigInt(stakingRewardTransfer.amount || '0'));
            }

            const stakingEntry = {
                timestamp: new Date(Number(entry.timestamp) / 1_000_000).toISOString(), // Convert nanoseconds to ISO string
                balance: Number(balance),
                block_height: entry.block,
                deposit,
                withdrawal,
                earnings,  // From staking_reward transfer amount
                _source: 'accounting-export',
                _isStakingReward: isStakingReward
            };

            if (entry.transactionHashes?.length > 0) {
                stakingEntry.hash = entry.transactionHashes[0];
            }

            stakingDataByPool.get(poolId).push(stakingEntry);
        }
    }

    // Sort entries for each pool (earnings already set from API)
    for (const [, poolEntries] of stakingDataByPool) {
        // Sort by block height descending (newest first)
        poolEntries.sort((a, b) => b.block_height - a.block_height);
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
    const processedHashes = new Map();

    // Fetch intents token metadata for symbol/decimals resolution
    const tokenMetadata = await getIntentsTokenMetadata();

    // Pre-fetch metadata for all tokens not in intents API (from cache or RPC)
    await prefetchTokenMetadata(entries, tokenMetadata);

    // Running balance state for sparse balance reconstruction
    // The API returns sparse balances - only tokens that changed are present in balanceAfter
    // We track cumulative state to know the actual balance after each entry
    const runningFungibleBalances = {};
    const runningIntentsBalances = {};

    // Sort entries by block height ascending to process in chronological order
    // This allows us to accumulate balances correctly
    const sortedEntries = [...entries].sort((a, b) => a.block - b.block);

    for (const entry of sortedEntries) {
        // Update running balance state from this entry's balanceAfter data
        const afterFt = entry.balanceAfter?.fungibleTokens || {};
        const afterIntents = entry.balanceAfter?.intentsTokens || {};

        for (const [token, balance] of Object.entries(afterFt)) {
            runningFungibleBalances[token] = balance;
        }
        for (const [token, balance] of Object.entries(afterIntents)) {
            runningIntentsBalances[token] = balance;
        }

        // Process NEAR transactions
        // A single transaction can span multiple blocks (receipts), so we deduplicate by hash
        // but always update the balance to use the latest block's balance_after (final state)
        const nearTx = convertToNearTransaction(entry, accountId);
        if (nearTx) {
            if (!processedHashes.has(nearTx.hash)) {
                transactions.push(nearTx);
                processedHashes.set(nearTx.hash, nearTx);
            } else {
                // Update with latest block's balance (entries are sorted ascending,
                // so later entries have the final balance after all receipts)
                processedHashes.get(nearTx.hash).balance = nearTx.balance;
            }
        }

        // Process fungible token transfers (both regular FT and intents/multi-token)
        // Balance comes from accumulated balanceAfter data (updated at start of loop)
        for (const transfer of entry.transfers || []) {
            if (transfer.type === 'ft' || transfer.type === 'mt') {
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

    // Earnings are already set from API - no recalculation needed
    // New entries (with correct earnings from API) take precedence over existing entries

    return merged;
}
