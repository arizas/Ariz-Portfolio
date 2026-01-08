// Token metadata cache stored in git storage
// Fetches ft_metadata from contracts and caches results

import { readTextFile, exists, writeFile } from './gitstorage.js';

export const tokenMetadataCacheFile = 'token-metadata.json';

// In-memory cache for runtime performance
let memoryCache = null;

/**
 * Get the full token metadata cache from git storage
 * @returns {Promise<Object>} Cache object keyed by contract ID
 */
export async function getTokenMetadataCache() {
    // Return memory cache if available
    if (memoryCache) {
        return memoryCache;
    }

    if (await exists(tokenMetadataCacheFile)) {
        try {
            memoryCache = JSON.parse(await readTextFile(tokenMetadataCacheFile));
            return memoryCache;
        } catch (e) {
            console.warn('Error reading token metadata cache:', e);
            return {};
        }
    }
    return {};
}

/**
 * Save the token metadata cache to git storage
 * @param {Object} cache - Cache object to save
 */
export async function saveTokenMetadataCache(cache) {
    memoryCache = cache;
    await writeFile(tokenMetadataCacheFile, JSON.stringify(cache, null, 2));
}

/**
 * Get cached metadata for a specific token
 * @param {string} contractId - Token contract ID
 * @returns {Promise<{symbol: string, decimals: number, name: string}|null>}
 */
export async function getCachedTokenMetadata(contractId) {
    const cache = await getTokenMetadataCache();
    return cache[contractId] || null;
}

/**
 * Store metadata for a token in the cache
 * @param {string} contractId - Token contract ID
 * @param {Object} metadata - Metadata to cache
 * @param {string} metadata.symbol - Token symbol
 * @param {number} metadata.decimals - Token decimals
 * @param {string} [metadata.name] - Token name
 */
export async function cacheTokenMetadata(contractId, metadata) {
    const cache = await getTokenMetadataCache();
    cache[contractId] = {
        ...metadata,
        fetchedAt: new Date().toISOString()
    };
    await saveTokenMetadataCache(cache);
}

/**
 * Clear the in-memory cache (useful for testing)
 */
export function clearMemoryCache() {
    memoryCache = null;
}
