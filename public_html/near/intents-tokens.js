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
            const contractAddress = token.assetId?.replace(/^nep1[43][15]:/, '');
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

/**
 * Check if a contract ID is from NEAR Intents
 * @param {string} contractId - Contract ID or token ID
 * @returns {boolean} True if this is an intents token
 */
export function isIntentsToken(contractId) {
    if (!contractId) return false;
    
    // Check for nep141:/nep245: prefix (intents asset IDs)
    if (/^nep1[43][15]:/.test(contractId)) {
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
 * Format: "SYMBOL ( NEAR Intents / Network )" for intents tokens
 * @param {string} contractId - Contract ID
 * @param {string} rawSymbol - Raw symbol from storage
 * @param {string} [blockchain] - Optional blockchain name
 * @returns {string} Display symbol with optional suffix
 */
export function getDisplaySymbol(contractId, rawSymbol, blockchain) {
    if (isIntentsToken(contractId)) {
        const networkName = blockchain ? getBlockchainDisplayName(blockchain) : null;
        if (networkName) {
            return `${rawSymbol} ( NEAR Intents / ${networkName} )`;
        }
        return `${rawSymbol} ( NEAR Intents )`;
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
    
    // Try to get metadata from cache
    let symbol = fallbackSymbol;
    let blockchain = null;
    
    if (metadata.has(contractId)) {
        const data = metadata.get(contractId);
        symbol = data.symbol;
        blockchain = data.blockchain;
    } else {
        const normalizedId = contractId.replace(/^nep1[43][15]:/, '');
        if (metadata.has(normalizedId)) {
            const data = metadata.get(normalizedId);
            symbol = data.symbol;
            blockchain = data.blockchain;
        }
    }
    
    return getDisplaySymbol(contractId, symbol, blockchain);
}

/**
 * Resolve decimals for a token from intents API or token metadata cache
 * @param {string} contractId - Contract ID
 * @param {number} fallbackDecimals - Fallback decimals if not found
 * @returns {Promise<number>} Token decimals
 */
export async function resolveDecimals(contractId, fallbackDecimals = 24) {
    const metadata = await getIntentsTokenMetadata();

    if (metadata.has(contractId)) {
        console.log(`resolveDecimals(${contractId}): found in intents metadata = ${metadata.get(contractId).decimals}`);
        return metadata.get(contractId).decimals;
    }

    const normalizedId = contractId.replace(/^nep1[43][15]:/, '');
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
