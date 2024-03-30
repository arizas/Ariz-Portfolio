import { getCustomExchangeRates, setCustomExchangeRates, getHistoricalPriceData, setHistoricalPriceData } from "../storage/domainobjectstore.js";

let cachedCurrencyList = ['USD'];
const defaultToken = 'NEAR';

export async function fetchNEARHistoricalPrices() {
    const chartdata = await fetch('https://api.nearblocks.io/v1/charts').then(r => r.json());
    const pricedata = {};
    chartdata.charts.forEach(dayEntry => pricedata[dayEntry.date.substring(0,'yyyy-MM-dd'.length)] = Number(dayEntry.near_price));
    await setHistoricalPriceData(defaultToken, 'USD', pricedata);
}

export async function getCurrencyList() {
    return cachedCurrencyList;
}

export async function getEODPrice(currency, datestring) {
    return (await getHistoricalPriceData(defaultToken, currency))[datestring];
}

export async function getCustomSellPrice(currency, datestring) {
    const customExchangeRates = await getCustomExchangeRates();
    return customExchangeRates[currency]?.[datestring]?.sell ?? await getEODPrice(currency, datestring);
}

export async function getCustomBuyPrice(currency, datestring) {
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
