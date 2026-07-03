import { fetchFromArizGateway } from "../arizgateway/arizgatewayaccess.js";
import { getCustomExchangeRates, setCustomExchangeRates, getHistoricalPriceData, setHistoricalPriceData, getCurrencyList as getStoredCurrencyList, setCurrencyList } from "../storage/domainobjectstore.js";
import { resolveSymbol } from "../near/intents-tokens.js";
import { retry } from "../near/retry.js";

const defaultToken = 'NEAR';
const skipFetchingPrices = {};

/**
 * Thrown when the price service (Ariz gateway) can't be reached for the current
 * spot prices after retries - i.e. a transient outage that affects *every* token,
 * as opposed to a single token genuinely having no price. Carries the token list
 * so the caller can show a clear "price service unavailable" banner instead of
 * making every holding look like it individually has "no price".
 */
export class PriceServiceUnavailableError extends Error {
    constructor(tokens, cause) {
        super(`Price service unavailable (could not fetch current prices for ${tokens.length} token(s))`);
        this.name = 'PriceServiceUnavailableError';
        this.tokens = tokens;
        this.cause = cause;
    }
}

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

    // One batch request for everything. Retry to ride out gateway cold starts
    // (fly.dev 502s on the first request after a restart/idle; those error
    // responses also lack CORS headers, surfacing as "CORS"/"Failed to fetch" in
    // the browser). Invalid scam symbols are already filtered out, so a batch
    // failure means the gateway itself is unavailable - retrying the whole batch
    // is the right move, not hammering it once per token.
    //
    // If retries are exhausted we let the error propagate: the caller must be able
    // to tell "the price service is unreachable" (transient, everything affected -
    // show a banner, keep cached cost basis) apart from "this token genuinely has
    // no price" (a per-token null below, e.g. scam tokens / ARIZ). Swallowing the
    // error here would collapse both into an indistinguishable "no price".
    let data;
    try {
        data = await retry(() => fetchFromArizGateway(
            `/api/prices/current?tokens=${encodeURIComponent(uniqueTokens.join(','))}&vs=${encodeURIComponent(vs)}`
        ), 4, 2000);
    } catch (e) {
        throw new PriceServiceUnavailableError(uniqueTokens, e);
    }
    for (const token of uniqueTokens) {
        // The gateway keys the response by the exact token string we passed in. A
        // null here means the gateway is reachable but has no price for this token.
        result[token] = data?.[token]?.[vs] ?? null;
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

    // USD-pegged stablecoins are ~1 USD. When the target currency is USD we can
    // short-circuit to 1. For other currencies, do NOT collapse to "USD": keep the
    // token symbol (USDC, USDT, USDC.e, ...) so the gateway prices it via its
    // CoinGecko id (usd-coin / tether) and applies the forex rate. Collapsing to
    // "USD" made the gateway look up a non-existent "usd" token and return 0, which
    // left stablecoin holdings with no historical cost basis in non-USD currencies.
    if (token.indexOf('USD') === 0 || token === 'USN') {
        if (currency.toUpperCase() === 'USD') {
            return 1;
        }
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

/**
 * Whole EOD price history for a token in a currency, as a map { 'yyyy-MM-dd': price }.
 * Mirrors getEODPrice's symbol resolution and stablecoin handling, but returns the
 * full series in one call so callers that need many dates (e.g. the value-over-time
 * chart) don't do one storage read per date. Triggers a single gateway fetch if the
 * history isn't cached yet.
 *
 * For USD-pegged stablecoins valued in USD (which getEODPrice short-circuits to 1)
 * the map has no dates; a sentinel { __constant: 1 } is returned instead so the
 * caller can treat every date as 1.
 *
 * @param {string} currency - target currency (e.g. 'nok')
 * @param {string} token - token symbol or contract id ('' / 'NEAR' for native NEAR)
 * @returns {Promise<Object<string, number> & {__constant?: number}>}
 */
export async function getEODPriceMap(currency, token = defaultToken) {
    if (token === "") {
        token = defaultToken;
    }

    const hasIntentsPrefix = /^nep(141|245):/.test(token);
    const hasNearSuffix = /\.(near|testnet)$/.test(token);
    const isImplicitAccount = token.length === 64 && /^[a-f0-9]+$/.test(token);
    if (hasIntentsPrefix || hasNearSuffix || isImplicitAccount) {
        token = await resolveSymbol(token);
    }

    // USD-pegged stablecoins are ~1 USD - match getEODPrice's USD short-circuit.
    if ((token.indexOf('USD') === 0 || token === 'USN') && currency.toUpperCase() === 'USD') {
        return { __constant: 1 };
    }

    let pricedata = await getHistoricalPriceData(token, currency);
    if (!pricedata || Object.keys(pricedata).length === 0) {
        const coinGeckoId = symbolToCoinGeckoId[token.toUpperCase()] || token.toLowerCase();
        if (!(await getNoPriceTokens()).has(coinGeckoId)) {
            try {
                await fetchHistoricalPricesFromArizGateway({ baseToken: token, currency });
                pricedata = await getHistoricalPriceData(token, currency);
            } catch (e) {
                console.error(`Failed to fetch price history for ${token}/${currency} from Ariz Gateway`, e);
            }
        }
    }
    return pricedata || {};
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
