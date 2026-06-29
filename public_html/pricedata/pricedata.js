import { fetchFromArizGateway } from "../arizgateway/arizgatewayaccess.js";
import { getCustomExchangeRates, setCustomExchangeRates, getHistoricalPriceData, setHistoricalPriceData, getCurrencyList as getStoredCurrencyList, setCurrencyList } from "../storage/domainobjectstore.js";
import { resolveSymbol } from "../near/intents-tokens.js";
import { retry } from "../near/retry.js";

const defaultToken = 'NEAR';
const skipFetchingPrices = {};

export function setSkipFetchingPrices(token, currency) {
    skipFetchingPrices[`${token}-${currency}`] = true;
}

// The Ariz Gateway fetches token price data and is the single authority on which
// tokens have no price at all (scam tokens, ARIZ credits). It exposes that set
// (and re-checks it over time), so the client never prompts to fetch prices that
// will never exist - and nothing has to be maintained per user. Cached once per
// session; reset with __resetNoPriceTokens (tests).
let noPriceTokensPromise;

async function getNoPriceTokens() {
    if (!noPriceTokensPromise) {
        noPriceTokensPromise = fetchFromArizGateway('/api/prices/nopricetokens')
            .then(list => new Set((Array.isArray(list) ? list : []).map(t => t.toLowerCase())))
            .catch(() => new Set());
    }
    return noPriceTokensPromise;
}

export function __resetNoPriceTokens() {
    noPriceTokensPromise = undefined;
}

// Map token symbols to CoinGecko IDs (Ariz Gateway uses CoinGecko API)
const symbolToCoinGeckoId = {
    'NEAR': 'near',
    'BTC': 'bitcoin',
    'ETH': 'ethereum',
    'SOL': 'solana',
    'AVAX': 'avalanche-2',
    'XRP': 'ripple',
    'USDC': 'usd-coin',
    'USDT': 'tether',
    'DAI': 'dai',
    'WETH': 'weth',
    'WBTC': 'wrapped-bitcoin',
    'STNEAR': 'staked-near',
    'NPRO': 'npro',
    'LONK': 'lonk-on-near',
    'SHITZU': 'shitzu',
};

export async function getCurrencyList() {
    let currencyList = await getStoredCurrencyList();
    if (currencyList.length === 0) {
        const current_prices = await fetchFromArizGateway('/api/prices/currencylist');
        currencyList = Object.keys(current_prices);
        await setCurrencyList(currencyList);
    }
    return currencyList;
}

export async function fetchHistoricalPricesFromArizGateway({ baseToken = "NEAR", currency, todate = new Date().toJSON() }) {
    // Convert symbol to CoinGecko ID (e.g., "BTC" -> "bitcoin")
    const coinGeckoId = symbolToCoinGeckoId[baseToken.toUpperCase()] || baseToken.toLowerCase();
    const pricesMap = await fetchFromArizGateway(`/api/prices/history?basetoken=${coinGeckoId}&currency=${currency}&todate=${todate}`);
    await setHistoricalPriceData(baseToken, currency, pricesMap);
}

// Real market symbols are short and contain no whitespace, slashes or URL
// punctuation. Scam tokens sometimes embed a whole URL or sentence in their
// symbol (e.g. "Claim Near Airdrop at https://..."), which has no price and can
// even make the gateway return 502 for the whole batch. Skip those up front.
function isLikelyValidSymbol(symbol) {
    return !!symbol && symbol.length <= 15 && !/[\s/:?#&]/.test(symbol);
}

/**
 * Fetch current (live spot) prices for multiple token symbols in one currency.
 * Uses the gateway /api/prices/current endpoint (proxies CoinGecko simple/price).
 * Resilient: invalid/junk symbols are skipped, and if a batch request fails
 * (e.g. gateway 502 on a bad token) it falls back to per-token requests so one
 * token can never zero out the rest.
 * @param {string[]} tokens - token symbols (e.g. ['NEAR', 'BTC'])
 * @param {string} currency - target currency (e.g. 'nok')
 * @returns {Promise<Object<string, number|null>>} map of symbol -> price (null if unavailable)
 */
export async function getCurrentPrices(tokens, currency) {
    const result = {};
    const vs = currency.toLowerCase();
    const uniqueTokens = [...new Set(tokens.filter(t => t && isLikelyValidSymbol(t)))];
    if (uniqueTokens.length === 0) {
        return result;
    }

    const fetchBatch = async (list) => {
        // Retry transient gateway hiccups (502s) a couple of times, quickly.
        const data = await retry(() => fetchFromArizGateway(
            `/api/prices/current?tokens=${encodeURIComponent(list.join(','))}&vs=${encodeURIComponent(vs)}`
        ), 2, 1500);
        for (const token of list) {
            // The gateway keys the response by the exact token string we passed in.
            result[token] = data?.[token]?.[vs] ?? null;
        }
    };

    try {
        await fetchBatch(uniqueTokens);
    } catch (e) {
        // A single bad token can fail the whole batch. Retry one at a time so the
        // rest still get prices.
        for (const token of uniqueTokens) {
            try {
                await fetchBatch([token]);
            } catch {
                result[token] = null;
            }
        }
    }
    return result;
}

/**
 * Fetch the current (live spot) price for a single token symbol.
 * @param {string} token - token symbol (e.g. 'NEAR')
 * @param {string} currency - target currency (e.g. 'nok')
 * @returns {Promise<number|null>} price, or null if unavailable
 */
export async function getCurrentPrice(token, currency) {
    const prices = await getCurrentPrices([token], currency);
    return prices[token] ?? null;
}

export async function getEODPrice(currency, datestring, token = defaultToken) {
    if (token === "") {
        token = defaultToken;
    }

    // Resolve symbol from contract ID (e.g., "nep141:eth-0xa0b86991...omft.near" -> "USDC")
    // This is needed because prices are stored by symbol, not contract ID
    // Only resolve if it looks like a contract ID:
    // - Has nep141:/nep245: prefix (intents asset IDs)
    // - Has .near/.testnet suffix (NEAR named accounts)
    // - Is a 64-char hex string (implicit accounts like USDC native)
    // Skip short symbols like "NEAR", "USD", "ETH", "USDC.e" (under 15 chars without NEAR suffixes)
    const hasIntentsPrefix = /^nep(141|245):/.test(token);
    const hasNearSuffix = /\.(near|testnet)$/.test(token);
    const isImplicitAccount = token.length === 64 && /^[a-f0-9]+$/.test(token);
    const isLikelyContractId = hasIntentsPrefix || hasNearSuffix || isImplicitAccount;
    if (isLikelyContractId) {
        token = await resolveSymbol(token);
    }

    if (token.indexOf('USD') === 0 || token === 'USN') {
        token = 'USD';
    }
    if (token === 'USD' && currency === 'USD') {
        return 1;
    }
    let pricedata = await getHistoricalPriceData(token, currency);
    const skipFetchingPricesKey = `${token}-${currency}`;
    if (pricedata[datestring] === undefined && !skipFetchingPrices[skipFetchingPricesKey]) {
        const coinGeckoId = symbolToCoinGeckoId[token.toUpperCase()] || token.toLowerCase();
        if ((await getNoPriceTokens()).has(coinGeckoId)) {
            // The gateway already knows this token has no price (scam tokens, ARIZ
            // credits). Skip it - the price simply isn't available.
            skipFetchingPrices[skipFetchingPricesKey] = true;
        } else {
            // Load the whole price history from the gateway automatically (no
            // prompt): either it loads, or the price is not available.
            try {
                await fetchHistoricalPricesFromArizGateway({ baseToken: token, currency });
                pricedata = await getHistoricalPriceData(token, currency);
            } catch (e) {
                console.error(`Failed to fetch prices for ${token}/${currency} from Ariz Gateway`, e);
            }
            // A single fetch returns the whole price history. If the date is
            // still missing, re-fetching per date would only repeat the same
            // whole-history request, so stop fetching for this token/currency.
            // (An empty result also means the gateway now knows it has no price,
            // so it joins the no-price set for everyone on the next session.)
            if (pricedata[datestring] === undefined) {
                skipFetchingPrices[skipFetchingPricesKey] = true;
            }
        }
    }
    const price = pricedata[datestring];
    return price ?? 0;
}

export async function getCustomSellPrice(currency, datestring, token) {
    if (token && token !== 'near') {
        return await getEODPrice(currency, datestring, token);
    }
    const customExchangeRates = await getCustomExchangeRates();
    return customExchangeRates[currency]?.[datestring]?.sell ?? await getEODPrice(currency, datestring);
}

export async function getCustomBuyPrice(currency, datestring, token) {
    if (token && token !== 'near') {
        return await getEODPrice(currency, datestring, token);
    }
    const customExchangeRates = await getCustomExchangeRates();
    return customExchangeRates[currency]?.[datestring]?.buy ?? await getEODPrice(currency, datestring);
}

export async function setCustomExchangeRateSell(currency, datestring, quantity, totalAmount) {
    const price = totalAmount / (quantity / 1e+24);

    const customExchangeRates = await getCustomExchangeRates();
    if (!customExchangeRates[currency]) {
        customExchangeRates[currency] = {};
    }
    customExchangeRates[currency][datestring] = { sell: price };
    await setCustomExchangeRates(customExchangeRates);
}

export async function setCustomExchangeRateBuy(currency, datestring, quantity, totalAmount) {
    const price = totalAmount / (quantity / 1e+24);

    const customExchangeRates = await getCustomExchangeRates();
    if (!customExchangeRates[currency]) {
        customExchangeRates[currency] = {};
    }
    customExchangeRates[currency][datestring] = { buy: price };
    await setCustomExchangeRates(customExchangeRates);
}
