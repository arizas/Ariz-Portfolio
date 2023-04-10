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

const baseurl = import.meta.url.substring(0, import.meta.url.lastIndexOf('/') + 1);
const basepath = baseurl.substring(location.origin.length);
Array.from(document.getElementsByClassName('nav-link')).forEach(navLink => {
    const targetPage = navLink.href.substring(location.origin.length + 1);
    navLink.href = basepath + targetPage;
    navLink.onclick = () => {
        goToPage(targetPage);
        return false;
    }
});

class AppNearNumbersComponent extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = html;
        document.querySelectorAll('link').forEach(lnk => this.shadowRoot.appendChild(lnk.cloneNode()));

        const mainContainer = this.shadowRoot.querySelector('#mainContainer');
        const numDecimals = 2;

        window.goToPage = (page) => {
            const pageElement = document.createElement(`${page}-page`);
            const path = `${basepath}${page}`;
            if ((window.top == window) && (location.pathname != path || location.search.indexOf('?account_id') == 0)) {
                history.pushState({}, null, path);
            }
            mainContainer.replaceChildren(pageElement);
        }

        if (location.href != baseurl) {
            goToPage(location.href.substring(baseurl.length));
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

if (window.top == window) {
    const registerServiceWorker = async () => {
        if ("serviceWorker" in navigator) {
            try {
                const registration = await navigator.serviceWorker.register(baseurl + "serviceworker.js", {
                    scope: baseurl,
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
}