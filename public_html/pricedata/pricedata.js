import { fetchFromArizGateway } from "../arizgateway/arizgatewayaccess.js";
import { getFromNearBlocks } from "../near/nearblocks.js";
import { getCustomExchangeRates, setCustomExchangeRates, getHistoricalPriceData, setHistoricalPriceData, getCurrencyList as getStoredCurrencyList, setCurrencyList } from "../storage/domainobjectstore.js";
import { modalAlert, modalYesNo } from "../ui/modal.js";

const defaultToken = 'NEAR';
const skipFetchingPrices = {};

export async function getCurrencyList() {
    let currencyList = await getStoredCurrencyList();
    if (currencyList.length === 0) {
        const current_prices = await fetchFromArizGateway('/api/prices/currencylist');
        currencyList = Object.keys(current_prices);
        await setCurrencyList(currencyList);
    }
    return currencyList;
}

export async function fetchHistoricalPricesFromArizGateway({ baseToken = "near", currency, todate = new Date().toJSON() }) {
    const pricesMap = await fetchFromArizGateway(`/api/prices/history?basetoken=${baseToken.toLowerCase()}&currency=${currency}&todate=${todate}`);
    await setHistoricalPriceData(baseToken, currency, pricesMap);
}

export async function fetchNEARHistoricalPricesFromNearBlocks() {
    const chartdata = await getFromNearBlocks('/v1/charts');
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
    if (token === "") {
        token = defaultToken;
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
