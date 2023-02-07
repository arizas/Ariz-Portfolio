import { readTextFile, writeFile, exists, git_init } from './storage/gitstorage.js';
import './near/stakingpool.js';
import './config/config.component.js';
import './transactionsview/transactionsview.component.js';
import './stakingview/stakingview.component.js';
import './storage/wasmgit.component.js';
import './yearreport/yearreport.component.js';
import { getCurrencyList } from './pricedata/pricedata.js';
import { accountsconfigfile, getAccounts, setAccounts } from './storage/domainobjectstore.js';

const config = document.getElementById('earnings-report-config');
const transactionsview = document.getElementById('transactions-view');
const stakingView = document.getElementById('staking-view');
const yearReport = document.getElementById('year-report');
const wasmgit = document.getElementById('wasm-git-config');

const numDecimals = 2;

(async () => {
    if (await exists(accountsconfigfile)) {
        config.setAccounts(await getAccounts());
    }

    const accountselect = document.querySelector('#accountselect');
    await Promise.all(config.getAccounts().map(async account => {
        const accountoption = document.createElement('option');
        accountoption.value = account;
        accountoption.text = account;
        accountselect.appendChild(accountoption);
    }));

    const currencyselect = document.querySelector('#currencyselect');
    (await getCurrencyList()).forEach(currency => {
        const currencyoption = document.createElement('option');
        currencyoption.value = currency;
        currencyoption.text = currency.toUpperCase();
        currencyselect.appendChild(currencyoption);
    });
    const viewSettingsChange = () => {
        const account = accountselect.value;
        const currency = currencyselect.value;
        transactionsview.updateView(account, currency, numDecimals);
        stakingView.updateView(account, currency, numDecimals);
        yearReport.updateView(currency, numDecimals);
    };
    accountselect.addEventListener('change', viewSettingsChange);
    currencyselect.addEventListener('change', viewSettingsChange);
    config.addEventListener('change', async () => {
        await setAccounts(config.getAccounts());
        viewSettingsChange();
    });
    wasmgit.addEventListener('sync', async () => {
        if (await exists(accountsconfigfile)) {
            config.setAccounts(await getAccounts());
        }
        viewSettingsChange();
    });
    yearReport.updateView(currencyselect.value, numDecimals);
})();