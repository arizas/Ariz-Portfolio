import { getCurrencyList } from '../pricedata/pricedata.js';
import { getCustomExchangeRatesAsTable, setCustomExchangeRatesFromTable } from '../storage/domainobjectstore.js';
import html from './customexchangerates-page.component.html.js';

customElements.define('customexchangerates-page',
    class extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this.shadowRoot.innerHTML = html;
            document.querySelectorAll('link').forEach(lnk => this.shadowRoot.appendChild(lnk.cloneNode()));
            this.shadowRoot.querySelector('#addcustomexchangeratebutton').onclick = async () => {
                this.addCustomExchangeRateRow();
                await this.storeCustomExchangeRates();
            }
            this.customExchangeRatesTable = this.shadowRoot.querySelector('#customexchangeratestable');
            this.loadExistingCustomExchangeRates();
        }

        async loadExistingCustomExchangeRates() {
            const tabledata = await getCustomExchangeRatesAsTable();
            tabledata.forEach(row => this.addCustomExchangeRateRow(row));
        }

        async storeCustomExchangeRates() {
            const customExchangeRatesTable = Array.from(this.customExchangeRatesTable.children).map(row => ({
                date: row.querySelector('.customexchangeratedate').value,
                currency: row.querySelector('.customexchangeratecurrency').value,
                price: row.querySelector('.customexchangerateprice  ').valueAsNumber,
                buysell: row.querySelector('.customexchangeratebuysell').value
            }));
            await setCustomExchangeRatesFromTable(customExchangeRatesTable);
        }

        async addCustomExchangeRateRow(rowdata = {}) {
            const rowtemplate = this.shadowRoot.querySelector('#customexchangeraterowtemplate');
            this.customExchangeRatesTable.appendChild(rowtemplate.content.cloneNode(true));

            const row = this.customExchangeRatesTable.lastElementChild;

            const currencyselect = row.querySelector('.customexchangeratecurrency');
            (await getCurrencyList()).forEach(currency => {
                const currencyoption = document.createElement('option');
                currencyoption.value = currency;
                currencyoption.text = currency.toUpperCase();
                currencyselect.appendChild(currencyoption);
            });

            const dateinput = row.querySelector('.customexchangeratedate');
            const priceinput = row.querySelector('.customexchangerateprice');
            const buysellselect = row.querySelector('.customexchangeratebuysell');

            currencyselect.value = rowdata.currency;
            dateinput.value = rowdata.date;
            priceinput.value = rowdata.price;
            buysellselect.value = rowdata.buysell;

            [
                dateinput,
                currencyselect,
                priceinput,
                buysellselect
            ].forEach(input => input.addEventListener('change', async (e) => await this.storeCustomExchangeRates()));

            row.querySelector('.removecustomexchangeratebutton').onclick = async () => {
                row.remove();
                await this.storeCustomExchangeRates();
            };
        }
    }
);
