import { getCustomExchangeRates, setCustomExchangeRates, getHistoricalPriceData, setHistoricalPriceData } from "../storage/domainobjectstore.js";

let cachedCurrencyList = ['USD', 'NOK'];
const defaultToken = 'NEAR';

export async function fetchNEARHistoricalPrices() {
    const chartdata = await fetch('https://api.nearblocks.io/v1/charts').then(r => r.json());
    const pricedata = {};
    chartdata.charts.forEach(dayEntry => pricedata[dayEntry.date.substring(0, 'yyyy-MM-dd'.length)] = Number(dayEntry.near_price));
    await setHistoricalPriceData(defaultToken, 'USD', pricedata);
}

export async function fetchNOKPrices() {
    const exchangeRates = await fetch('https://data.norges-bank.no/api/data/EXR/B.USD.NOK.SP?format=sdmx-json&startPeriod=2020-01-01&endPeriod='
        + new Date().toJSON().substring(0, 'yyyy-MM-dd'.length)
        + '&locale=en').then(r => r.json());
    const observations = exchangeRates.data.dataSets[0].series['0:0:0:0'].observations;

    const ratesPerDay = {};
    const tokenUSDPriceData = await getHistoricalPriceData(defaultToken, 'USD');

    exchangeRates.data.structure.dimensions.observation.find(observation => observation.id === 'TIME_PERIOD').values.forEach(
        (value, ndx) => {
            const dateString = value.id;
            ratesPerDay[dateString] = Number(observations[ndx][0]);
        });
    const allDaysSorted = Object.keys(tokenUSDPriceData).sort();

    let previousNOKprice = 0;
    for (const dateString of allDaysSorted) {
        const usdPrice = tokenUSDPriceData[dateString];
        const nokPrice = ratesPerDay[dateString];
        if (!nokPrice) {
            ratesPerDay[dateString] = previousNOKprice;
        } else {
            previousNOKprice = nokPrice;
        }
        ratesPerDay[dateString] *= usdPrice;
    }
    await setHistoricalPriceData(defaultToken, 'NOK', ratesPerDay);
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
