import { fetchFromArizGateway } from "../arizgateway/arizgatewayaccess.js";
import { getCustomExchangeRates, setCustomExchangeRates, getHistoricalPriceData, setHistoricalPriceData, getCurrencyList as getStoredCurrencyList, setCurrencyList } from "../storage/domainobjectstore.js";
import { modalAlert, modalYesNo } from "../ui/modal.js";
import { resolveSymbol } from "../near/intents-tokens.js";

const defaultToken = 'NEAR';
const skipFetchingPrices = {};

export function setSkipFetchingPrices(token, currency) {
    skipFetchingPrices[`${token}-${currency}`] = true;
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
        if (await modalYesNo('Fetch price data from Ariz gateway?',
            `Price for ${token}-${currency} on ${datestring} is missing locally.
            Would you like to try fetch updated prices from Ariz Gateway?
        `)) {
            try {
                await fetchHistoricalPricesFromArizGateway({ baseToken: token, currency });
                pricedata = await getHistoricalPriceData(token, currency);
            } catch (e) {
                await modalAlert('Error fetching price data from Ariz Gateway',
                    `There was an error fetching prices for ${token} / ${currency} from Ariz Gateway:
                ${e.message}
                `);
            }
        } else {
            skipFetchingPrices[skipFetchingPricesKey] = true;
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
