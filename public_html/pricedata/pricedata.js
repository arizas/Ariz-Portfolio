import { getNetConversions, setNetConversions } from "../storage/domainobjectstore.js";

const cachedPricesPerCurrency = {};

export async function getCurrencyList() {
    const current_prices = (await (await fetch('https://api.coingecko.com/api/v3/coins/near')).json()).market_data.current_price;
    return Object.keys(current_prices);
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

export async function getNetWithdrawalPrice(currency, datestring) {
    const netConversions = await getNetConversions();
    return netConversions[currency]?.[datestring]?.withdrawal ?? await getEODPrice(currency, datestring);
}

export async function getNetDepositPrice(currency, datestring) {
    const netConversions = await getNetConversions();
    return netConversions[currency]?.[datestring]?.deposit ?? await getEODPrice(currency, datestring);
}

export async function setNetWithdrawalPrice(currency, datestring, quantity, totalAmount) {
    const withdrawalPrice = totalAmount / (quantity / 1e+24);

    const netConversions = await getNetConversions();
    if (!netConversions[currency]) {
        netConversions[currency] = {};
    }
    netConversions[currency][datestring] = { withdrawal: withdrawalPrice, withdrawalQuantity: quantity };
    await setNetConversions(netConversions);
}

export async function setNetDepositPrice(currency, datestring, quantity, totalAmount) {
    const depositPrice = totalAmount / (quantity / 1e+24);

    const netConversions = await getNetConversions();
    if (!netConversions[currency]) {
        netConversions[currency] = {};
    }
    netConversions[currency][datestring] = { deposit: depositPrice, depositQuantiy: quantity };
    await setNetConversions(netConversions);
}
