import { exists } from './storage/gitstorage.js';
import './near/stakingpool.js';
import './accounts/accounts-page.component.js';
import './accesskeys/accesskeys-page.component.js';
import './transactions/transactions-page.component.js';
import './stakingview/staking-page.component.js';
import './storage/storage-page.component.js';
import './counterparties/counterparties-page.component.js';
import './portfolio/portfolio-page.component.js';
import './yearreport/yearreport-page.component.js';
import './arizcredits/arizcredits-page.component.js';
import './dataagent/ai-assistant-page.component.js';
import './yearreport/yearreport-print.component.js';
import './yearreport/yearsummary-alltokens-print.component.js';

import { getCurrencyList } from './pricedata/pricedata.js';
import { accountsconfigfile, getAccounts, setAccounts } from './storage/domainobjectstore.js';
import html from './app.html.js';
import { isSignedIn, loginToArizGateway, logout } from './arizgateway/arizgatewayaccess.js';

const baseurl = import.meta.url.substring(0, import.meta.url.lastIndexOf('/') + 1);
const basepath = baseurl.substring(location.origin.length);

class AppNearNumbersComponent extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = html;
        document.querySelectorAll('link').forEach(lnk => this.shadowRoot.appendChild(lnk.cloneNode()));

        const mainContainer = this.shadowRoot.querySelector('#mainContainer');
        const numDecimals = 2;

        window.goToPage = (page) => {
            const pageElement = document.createElement(`${page}${page.endsWith('-print') ? '' : '-page'}`);
            const path = `${basepath}${page}`;
            if ((window.top == window) && (location.pathname != path || location.search.indexOf('?account_id') == 0)) {
                history.pushState({}, null, path);
            }
            if (page.endsWith('-print')) {
                this.shadowRoot.querySelector('nav').remove();
            }
            mainContainer.replaceChildren(pageElement);
            markCurrentPage(page);
        }

        // Say in the menu which page is open — also on the dropdown holding
        // it, whose items are out of sight until it is opened.
        const markCurrentPage = (page) => {
            this.shadowRoot.querySelectorAll('nav a[data-page]').forEach((a) => {
                const current = a.dataset.page === page;
                a.classList.toggle('active', current);
                if (current) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
            });
            this.shadowRoot.querySelectorAll('nav .dropdown').forEach((dropdown) => {
                dropdown.querySelector('.dropdown-toggle').classList.toggle('active', !!dropdown.querySelector('a.active'));
            });
        };

        if (location.href != baseurl) {
            const page = location.href.substring(baseurl.length).replace(/\/$/, '').split('?')[0];
            if (page) {
                goToPage(location.href.substring(baseurl.length).replace(/\/$/, '').split('?')[0]);
            }
        }

        // The navbar lives in this component's shadow DOM, so Bootstrap's
        // data-bs-toggle collapse handler (delegated on document) never reaches
        // the hamburger toggler. Wire it up manually against the shadow-DOM
        // element instead, otherwise the menu can't be opened on mobile widths.
        const navbarCollapse = this.shadowRoot.querySelector('#navbarNavAltMarkup');
        const navbarToggler = this.shadowRoot.querySelector('.navbar-toggler');
        const navbarCollapseInstance = bootstrap.Collapse.getOrCreateInstance(navbarCollapse, { toggle: false });
        navbarToggler.addEventListener('click', () => navbarCollapseInstance.toggle());

        // The menu's dropdowns, wired by hand for the same reason as the
        // toggler: Bootstrap's dropdown plugin listens on document and does not
        // see into this shadow DOM. Open on click, one at a time; close on a
        // click anywhere else, on Escape, and after navigating.
        const dropdowns = [...this.shadowRoot.querySelectorAll('nav .dropdown')];
        const closeDropdowns = (except = null) => dropdowns.forEach((dropdown) => {
            if (dropdown === except) return;
            dropdown.querySelector('.dropdown-menu').classList.remove('show');
            dropdown.querySelector('.dropdown-toggle').setAttribute('aria-expanded', 'false');
        });
        dropdowns.forEach((dropdown) => {
            const toggle = dropdown.querySelector('.dropdown-toggle');
            const menu = dropdown.querySelector('.dropdown-menu');
            toggle.addEventListener('click', () => {
                const open = !menu.classList.contains('show');
                closeDropdowns(dropdown);
                menu.classList.toggle('show', open);
                toggle.setAttribute('aria-expanded', String(open));
            });
        });
        document.addEventListener('click', (evt) => {
            const path = evt.composedPath();
            if (!dropdowns.some((dropdown) => path.includes(dropdown))) closeDropdowns();
        });
        document.addEventListener('keydown', (evt) => {
            if (evt.key === 'Escape') closeDropdowns();
        });

        this.shadowRoot.querySelectorAll('a').forEach(a => {
            if (a.dataset['page']) {
                a.onclick = (evt) => {
                    evt.preventDefault();
                    window.goToPage(a.dataset['page']);
                    closeDropdowns();
                    // Collapse the mobile menu after navigating.
                    navbarCollapseInstance.hide();
                }
            }
        });

        const loginButton = this.shadowRoot.querySelector('#loginbutton');
        const refreshLoginButton = async () => {
            loginButton.innerHTML = (await isSignedIn()) ? 'Logout' : 'Login';
        };
        loginButton.addEventListener('click', async () => {
            // near-connect resolves in-page (no redirect), so refresh the label
            // once the login/logout settles.
            if (await isSignedIn()) {
                await logout();
            } else {
                await loginToArizGateway();
            }
            await refreshLoginButton();
        });
        refreshLoginButton();

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

customElements.define('app-near-account-report', AppNearNumbersComponent);
