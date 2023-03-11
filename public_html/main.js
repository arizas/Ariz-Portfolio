import { exists } from './storage/gitstorage.js';
import './near/stakingpool.js';
import './accounts/accounts-page.component.js';
import './transactions/transactions-page.component.js';
import './stakingview/staking-page.component.js';
import './storage/storage-page.component.js';
import './yearreport/yearreport-page.component.js';
import { getCurrencyList } from './pricedata/pricedata.js';
import { accountsconfigfile, getAccounts, setAccounts } from './storage/domainobjectstore.js';
import html from './app.html.js';

class AppNearNumbersComponent extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = html;
        document.querySelectorAll('link').forEach(lnk => this.shadowRoot.appendChild(lnk.cloneNode()));

        const transactionsview = this.shadowRoot.getElementById('transactions-view');
        const stakingView = this.shadowRoot.getElementById('staking-view');
        const yearReport = this.shadowRoot.getElementById('year-report');
        const wasmgit = this.shadowRoot.getElementById('wasm-git-config');

        const numDecimals = 2;

        const mainContainer = this.shadowRoot.querySelector('#mainContainer')
        window.goToPage = (page) => {
            const pageElement = document.createElement(`${page}-page`);
            const path = `/${page}`;
            if (location.pathname != path || location.search.indexOf('?account_id') == 0) {
                history.pushState({}, null, path);
            }
            mainContainer.replaceChildren(pageElement);
        }
        if (location.pathname.length > 1) {
            goToPage(location.pathname.substring(1));
        }

        const init = (async () => {
            if (await exists(accountsconfigfile)) {
                config.setAccounts(await getAccounts());
            }

            const accountselect = this.shadowRoot.querySelector('#accountselect');
            await Promise.all(config.getAccounts().map(async account => {
                const accountoption = document.createElement('option');
                accountoption.value = account;
                accountoption.text = account;
                accountselect.appendChild(accountoption);
            }));

            const currencyselect = this.shadowRoot.querySelector('#currencyselect');
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
            
        });
    }
}

customElements.define('app-near-numbers', AppNearNumbersComponent);

const registerServiceWorker = async () => {
    if ("serviceWorker" in navigator) {
        const serviceworkerscope = import.meta.url.substring(0, import.meta.url.lastIndexOf('/') + 1);
        console.log('serviceworkerscope', serviceworkerscope);
        try {
            const registration = await navigator.serviceWorker.register("/serviceworker.js", {
                scope: serviceworkerscope,
            });
            registration.onupdatefound = () => {
                console.log('update available');
            };
            if (registration.installing) {
                console.log("Service worker installing");
            } else if (registration.waiting) {
                console.log("Service worker installed");
            } else if (registration.active) {
                console.log("Service worker active");
                await registration.update();
            }

        } catch (error) {
            console.error(`Registration failed with ${error}`);
        }
    }
};
registerServiceWorker();