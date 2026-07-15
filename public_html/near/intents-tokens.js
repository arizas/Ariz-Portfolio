// NEAR Intents token metadata resolver
// Fetches token metadata once per app load and caches it for runtime symbol resolution

const INTENTS_TOKENS_API = 'https://1click.chaindefuser.com/v0/tokens';

// Cache for intents token metadata (populated on first access)
let intentsTokenCache = null;
let fetchPromise = null;

/**
 * Fetch and cache intents token metadata from the API
 * Called once per app load, subsequent calls return cached data
 * @returns {Promise<Map<string, {symbol: string, decimals: number, blockchain: string, isIntents: boolean}>>}
 */
export async function getIntentsTokenMetadata() {
    // Return cached data if available
    if (intentsTokenCache) {
        return intentsTokenCache;
    }
    
    // If already fetching, wait for that promise
    if (fetchPromise) {
        return fetchPromise;
    }
    
    // Start fetching
    fetchPromise = fetchIntentsTokenMetadata();
    intentsTokenCache = await fetchPromise;
    fetchPromise = null;
    
    return intentsTokenCache;
}

/**
 * Internal function to fetch token metadata
 */
async function fetchIntentsTokenMetadata() {
    try {
        const response = await fetch(INTENTS_TOKENS_API);
        if (!response.ok) {
            console.warn('Failed to fetch intents token metadata, using fallback');
            return new Map();
        }
        
        const tokens = await response.json();
        const cache = new Map();
        
        for (const token of tokens) {
            const metadata = {
                symbol: token.symbol,
                decimals: token.decimals,
                blockchain: token.blockchain || 'near',
                isIntents: true
            };
            
            // Store by assetId (e.g., "nep141:eth.omft.near")
            cache.set(token.assetId, metadata);
            
            // Also store by contract address without prefix for legacy lookups
            const contractAddress = token.assetId?.replace(/^nep(141|245):/, '');
            if (contractAddress && contractAddress !== token.assetId) {
                cache.set(contractAddress, metadata);
            }
        }
        
        console.log(`Loaded ${tokens.length} intents token metadata entries`);
        return cache;
    } catch (e) {
        console.warn('Error fetching intents token metadata:', e);
        return new Map();
    }
}

// Confidential (TEE-ledger) holdings are tracked as their own token bucket,
// keyed by the intents asset id with this prefix (e.g.
// "confidential:nep141:btc.omft.near"). The prefix keeps confidential balances
// in a separate year-report FIFO bucket from the public intents bucket, so
// every shield/unshield/confidential-swap realizes profit/loss like any other
// bucket move (see docs/tax-classification-intents.md).
export const CONFIDENTIAL_TOKEN_PREFIX = 'confidential:';

/**
 * Check if a token ID refers to the confidential (TEE) intents ledger
 * @param {string} contractId - Contract ID or token ID
 * @returns {boolean}
 */
export function isConfidentialToken(contractId) {
    return !!contractId && contractId.startsWith(CONFIDENTIAL_TOKEN_PREFIX);
}

/**
 * Strip the confidential: prefix so metadata lookups resolve against the
 * underlying intents asset id
 * @param {string} contractId
 * @returns {string}
 */
export function stripConfidentialPrefix(contractId) {
    return isConfidentialToken(contractId)
        ? contractId.slice(CONFIDENTIAL_TOKEN_PREFIX.length)
        : contractId;
}

/**
 * Check if a contract ID is from NEAR Intents
 * @param {string} contractId - Contract ID or token ID
 * @returns {boolean} True if this is an intents token
 */
export function isIntentsToken(contractId) {
    if (!contractId) return false;

    // Confidential ids wrap an intents asset id
    contractId = stripConfidentialPrefix(contractId);

    // Check for nep141:/nep245: prefix (intents asset IDs)
    if (/^nep(141|245):/.test(contractId)) {
        return true;
    }

    // Check for omft.near suffix (NEAR Intents bridge tokens)
    if (contractId.includes('.omft.near')) {
        return true;
    }

    return false;
}

/**
 * Get blockchain name in display format
 * @param {string} blockchain - Blockchain code from API (eth, sol, base, arb, etc.)
 * @returns {string} Display name
 */
function getBlockchainDisplayName(blockchain) {
    const names = {
        'eth': 'Ethereum',
        'sol': 'Solana',
        'base': 'Base',
        'arb': 'Arbitrum',
        'near': 'NEAR',
        'btc': 'Bitcoin',
        'xrp': 'XRP Ledger',
        'avax': 'Avalanche',
        'bsc': 'BNB Chain',
        'polygon': 'Polygon',
        'op': 'Optimism'
    };
    return names[blockchain?.toLowerCase()] || blockchain?.toUpperCase() || 'Unknown';
}

/**
 * Get display symbol for a token, adding network info for intents tokens
 * Format: "SYMBOL ( NEAR Intents / Network )" for intents tokens,
 * "SYMBOL ( Confidential / Network )" for confidential (TEE-ledger) holdings
 * @param {string} contractId - Contract ID
 * @param {string} rawSymbol - Raw symbol from storage
 * @param {string} [blockchain] - Optional blockchain name
 * @returns {string} Display symbol with optional suffix
 */
export function getDisplaySymbol(contractId, rawSymbol, blockchain) {
    if (isIntentsToken(contractId)) {
        const bucketLabel = isConfidentialToken(contractId) ? 'Confidential' : 'NEAR Intents';
        const networkName = blockchain ? getBlockchainDisplayName(blockchain) : null;
        if (networkName) {
            return `${rawSymbol} ( ${bucketLabel} / ${networkName} )`;
        }
        return `${rawSymbol} ( ${bucketLabel} )`;
    }
    return rawSymbol;
}

/**
 * Get display symbol asynchronously, resolving blockchain from API if needed
 * @param {string} contractId - Contract ID
 * @param {string} fallbackSymbol - Fallback symbol if not found in API
 * @returns {Promise<string>} Display symbol with optional suffix
 */
export async function resolveDisplaySymbol(contractId, fallbackSymbol) {
    const metadata = await getIntentsTokenMetadata();

    // Metadata is keyed by the underlying intents asset id — strip the
    // confidential: prefix for lookups, keep the original id for the label.
    const assetId = stripConfidentialPrefix(contractId);
    const fallback = fallbackSymbol !== undefined && fallbackSymbol === contractId ? assetId : fallbackSymbol;

    // Try to get metadata from cache
    let symbol = fallback;
    let blockchain = null;

    if (metadata.has(assetId)) {
        const data = metadata.get(assetId);
        symbol = data.symbol;
        blockchain = data.blockchain;
    } else {
        const normalizedId = assetId.replace(/^nep(141|245):/, '');
        if (metadata.has(normalizedId)) {
            const data = metadata.get(normalizedId);
            symbol = data.symbol;
            blockchain = data.blockchain;
        }
    }

    return getDisplaySymbol(contractId, symbol, blockchain);
}

/**
 * Resolve symbol for a token from intents API or token metadata cache
 * This is used for price lookups - prices are stored by symbol (e.g., "USDC"), not contract ID
 * @param {string} contractId - Contract ID (may include nep141: prefix)
 * @returns {Promise<string>} Token symbol (e.g., "USDC") or the contractId if not found
 */
export async function resolveSymbol(contractId) {
    if (!contractId) return contractId;

    // Confidential ids resolve like their underlying intents asset (prices are
    // by symbol, and the confidential form of a token is the same asset).
    contractId = stripConfidentialPrefix(contractId);

    const metadata = await getIntentsTokenMetadata();

    // Check intents token cache first (with original ID including prefix)
    if (metadata.has(contractId)) {
        return metadata.get(contractId).symbol;
    }

    // Strip nep141:/nep245: prefix if present
    const normalizedId = contractId.replace(/^nep(141|245):/, '');

    // Check cache with normalized ID
    if (metadata.has(normalizedId)) {
        return metadata.get(normalizedId).symbol;
    }

    // Try with nep141: prefix (for implicit account contract IDs)
    const withPrefix = `nep141:${normalizedId}`;
    if (metadata.has(withPrefix)) {
        return metadata.get(withPrefix).symbol;
    }

    // Check token metadata cache (populated from ft_metadata RPC calls)
    try {
        const { getCachedTokenMetadata, cacheTokenMetadata } = await import('../storage/token-metadata-cache.js');
        const cachedMetadata = await getCachedTokenMetadata(normalizedId);
        if (cachedMetadata?.symbol) {
            return cachedMetadata.symbol;
        }

        // Fetch from RPC if not in any cache
        const { fetchFtMetadata } = await import('./rpc.js');
        const ftMetadata = await fetchFtMetadata(normalizedId);
        if (ftMetadata?.symbol) {
            await cacheTokenMetadata(normalizedId, {
                symbol: ftMetadata.symbol,
                decimals: ftMetadata.decimals,
                name: ftMetadata.name
            });
            return ftMetadata.symbol;
        }
    } catch (e) {
        console.warn(`resolveSymbol(${contractId}): error fetching metadata:`, e);
    }

    // Return the original contractId if symbol couldn't be resolved
    return contractId;
}

/**
 * Resolve decimals for a token from intents API or token metadata cache
 * @param {string} contractId - Contract ID
 * @param {number} fallbackDecimals - Fallback decimals if not found
 * @returns {Promise<number>} Token decimals
 */
export async function resolveDecimals(contractId, fallbackDecimals = 24) {
    // Confidential ids share the underlying intents asset's decimals.
    contractId = stripConfidentialPrefix(contractId);

    const metadata = await getIntentsTokenMetadata();

    if (metadata.has(contractId)) {
        console.log(`resolveDecimals(${contractId}): found in intents metadata = ${metadata.get(contractId).decimals}`);
        return metadata.get(contractId).decimals;
    }

    const normalizedId = contractId.replace(/^nep(141|245):/, '');
    if (metadata.has(normalizedId)) {
        console.log(`resolveDecimals(${contractId}): found in intents metadata (normalized) = ${metadata.get(normalizedId).decimals}`);
        return metadata.get(normalizedId).decimals;
    }

    // Check token metadata cache (populated from ft_metadata RPC calls)
    try {
        const { getCachedTokenMetadata, cacheTokenMetadata } = await import('../storage/token-metadata-cache.js');
        const cachedMetadata = await getCachedTokenMetadata(normalizedId);
        if (cachedMetadata) {
            console.log(`resolveDecimals(${contractId}): found in git cache = ${cachedMetadata.decimals}`);
            return cachedMetadata.decimals;
        }

        // Fetch from RPC if not in any cache
        const { fetchFtMetadata } = await import('./rpc.js');
        console.log(`resolveDecimals(${contractId}): fetching from RPC...`);
        const ftMetadata = await fetchFtMetadata(normalizedId);
        if (ftMetadata) {
            console.log(`resolveDecimals(${contractId}): fetched from RPC = ${ftMetadata.decimals}`);
            await cacheTokenMetadata(normalizedId, {
                symbol: ftMetadata.symbol,
                decimals: ftMetadata.decimals,
                name: ftMetadata.name
            });
            return ftMetadata.decimals;
        }
    } catch (e) {
        console.warn(`resolveDecimals(${contractId}): error fetching metadata:`, e);
    }

    console.log(`resolveDecimals(${contractId}): using fallback = ${fallbackDecimals}`);
    return fallbackDecimals;
}
