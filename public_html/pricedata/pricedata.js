import { getCustomExchangeRates, setCustomExchangeRates, getHistoricalPriceData, setHistoricalPriceData, getCustomRealizationRates } from "../storage/domainobjectstore.js";

const defaultToken = 'NEAR';
const COINGECKO_API_KEY = '__COINGECKO_API_KEY__';

let cachedCurrencyList;

export async function getCurrencyList() {
    if (cachedCurrencyList) {
        return cachedCurrencyList;
    }
    const current_prices = (await (await fetch('https://api.coingecko.com/api/v3/coins/near')).json()).market_data.current_price;
    cachedCurrencyList = Object.keys(current_prices);
    return cachedCurrencyList;
}

export async function fetchHistoricalPricesFromCoinGecko({baseToken="NEAR", currency, todate=new Date().toJSON() }) {
    const url = `https://pro-api.coingecko.com/api/v3/coins/${baseToken.toLowerCase()}/market_chart/range?vs_currency=${currency}&from=0&to=${Math.floor(new Date(todate).getTime() / 1000)}`;

    const prices = (await fetch(url, {
        headers: {
            "x-cg-pro-api-key": `${COINGECKO_API_KEY}`
        }
    }).then(r => r.json())).prices;
    const pricesMap = {};
    prices.forEach(priceEntry => {
        const datestring = new Date(priceEntry[0]).toJSON().substring(0,'yyyy-MM-dd'.length);
        const price = priceEntry[1];
        pricesMap[datestring] = price;
    });
    await setHistoricalPriceData(baseToken, currency, pricesMap);
}

export async function fetchNEARHistoricalPricesFromNearBlocks() {
    const chartdata = await fetch('https://api.nearblocks.io/v1/charts').then(r => r.json());
    const pricedata = await getHistoricalPriceData(defaultToken, 'USD');
    chartdata.charts.forEach(dayEntry => pricedata[dayEntry.date.substring(0, 'yyyy-MM-dd'.length)] = Number(dayEntry.near_price));
    await setHistoricalPriceData(defaultToken, 'USD', pricedata);
}

export async function importYahooNEARHistoricalPrices(data) {
    const lines = data.split(/\n/);
    const pricedata = await getHistoricalPriceData(defaultToken, 'USD');
    lines.slice(1).forEach(line => {
        const cols = line.split(',');
        pricedata[cols[0]] = parseFloat(cols[4]);
    });
    await setHistoricalPriceData(defaultToken, 'USD', pricedata);
}

export async function fetchNOKPrices() {
    const exchangeRates = await fetch('https://data.norges-bank.no/api/data/EXR/B.USD.NOK.SP?format=sdmx-json&startPeriod=2020-01-01&endPeriod='
        + new Date().toJSON().substring(0, 'yyyy-MM-dd'.length)
        + '&locale=en').then(r => r.json());
    const observations = exchangeRates.data.dataSets[0].series['0:0:0:0'].observations;

    const nearNOKPricePerDay = {};
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
        nearNOKPricePerDay[dateString] = ratesPerDay[dateString] * usdPrice;
    }
    await setHistoricalPriceData(defaultToken, 'NOK', nearNOKPricePerDay);
    await setHistoricalPriceData('USD', 'NOK', ratesPerDay);
}

export async function getEODPrice(currency, datestring, token = defaultToken) {
    if (token.indexOf('USD') === 0 || token === 'USN') {
        token = 'USD';
    }
    if (token === 'USD' && currency === 'USD') {
        return 1;
    }
    const pricedata = await getHistoricalPriceData(token, currency);
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
