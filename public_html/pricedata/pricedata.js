import { getCustomExchangeRates, setCustomExchangeRates } from "../storage/domainobjectstore.js";

const cachedPricesPerCurrency = {};
let cachedCurrencyList;

export async function getCurrencyList() {
    if (cachedCurrencyList) {
        return cachedCurrencyList;
    }
    const current_prices = (await (await fetch('https://api.coingecko.com/api/v3/coins/near')).json()).market_data.current_price;
    cachedCurrencyList = Object.keys(current_prices)
    return cachedCurrencyList;
}

export async function getHistoricalPrices(currency) {
    if (!cachedPricesPerCurrency[currency]) {
        cachedPricesPerCurrency[currency] = (await fetch(`https://api.coingecko.com/api/v3/coins/near/market_chart/range?vs_currency=${currency}&from=0&to=${new Date().getTime() / 1000}`).then(r => r.json())).prices;
    }
    return cachedPricesPerCurrency[currency];
}

export async function getEODPrice(currency, datestring) {
    const timestamp = new Date(datestring).getTime();
    const pricehistory = (await getHistoricalPrices(currency));
    const priceforday = pricehistory.find(entry => entry[0] === timestamp);
    if (priceforday) {
        return priceforday[1];
    } else {
        return null;
    }
}

export async function getCustomSellPrice(currency, datestring) {
    const customExchangeRates = await getCustomExchangeRates();
    return customExchangeRates[currency]?.[datestring]?.withdrawal ?? await getEODPrice(currency, datestring);
}

export async function getCustomBuyPrice(currency, datestring) {
    const customExchangeRates = await getCustomExchangeRates();
    return customExchangeRates[currency]?.[datestring]?.deposit ?? await getEODPrice(currency, datestring);
}

export async function setCustomExchangeRateSell(currency, datestring, quantity, totalAmount) {
    const price = totalAmount / (quantity / 1e+24);

    const customExchangeRates = await getCustomExchangeRates();
    if (!customExchangeRates[currency]) {
        customExchangeRates[currency] = {};
    }
    customExchangeRates[currency][datestring] = { withdrawal: price, withdrawalQuantity: quantity };
    await setCustomExchangeRates(customExchangeRates);
}

export async function setCustomExchangeRateBuy(currency, datestring, quantity, totalAmount) {
    const price = totalAmount / (quantity / 1e+24);

    const customExchangeRates = await getCustomExchangeRates();
    if (!customExchangeRates[currency]) {
        customExchangeRates[currency] = {};
    }
    customExchangeRates[currency][datestring] = { deposit: price, depositQuantiy: quantity };
    await setCustomExchangeRates(customExchangeRates);
}
