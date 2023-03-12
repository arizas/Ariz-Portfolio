import { getCurrencyList, getEODPrice } from '../pricedata/pricedata.js';
import { getStakingAccounts } from '../near/stakingpool.js';

import { getAccounts, getStakingRewardsForAccountAndPool } from '../storage/domainobjectstore.js';
import html from './staking-page.component.html.js';
customElements.define('staking-page',
    class extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this.readyPromise = this.loadHTML();
        }

        async loadHTML() {
            this.shadowRoot.innerHTML = html;
            this.stakingRewardsTable = this.shadowRoot.getElementById('stakingrewardstable');
            document.querySelectorAll('link').forEach(lnk => this.shadowRoot.appendChild(lnk.cloneNode()));

            const accountselect = this.shadowRoot.querySelector('#accountselect');
            await Promise.all((await getAccounts()).map(async account => {
                const accountoption = document.createElement('option');
                accountoption.value = account;
                accountoption.text = account;
                accountselect.appendChild(accountoption);
            }));

            const numDecimals = 2;
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
                this.updateView(account, currency, numDecimals);
            };
            accountselect.addEventListener('change', viewSettingsChange);
            currencyselect.addEventListener('change', viewSettingsChange);

            return this.shadowRoot;
        }

        async updateView(account, convertToCurrency, numDecimals) {
            const stakingAccounts = await getStakingAccounts(account);
            const stakingPoolOptionTemplate = this.shadowRoot.getElementById('stakingpoolselectoption');
            const stakingPoolSelect = this.shadowRoot.getElementById('stakingpoolselect');
            while (stakingPoolSelect.lastElementChild) {
                stakingPoolSelect.removeChild(stakingPoolSelect.lastElementChild);
            }
            stakingAccounts.forEach(async stakingAccount => {
                const option = stakingPoolOptionTemplate.cloneNode(true).content;
                option.querySelector('input').id = stakingAccount;
                option.querySelector('label').htmlFor = stakingAccount;
                option.querySelector('label').innerHTML = stakingAccount;
                option.querySelector('input').addEventListener('click', async () => {
                    const rewards = await getStakingRewardsForAccountAndPool(account, stakingAccount);

                    const stakingRewardRowTemplate = this.shadowRoot.querySelector('#stakingrewardrowtemplate');
                    let totalEarnings = 0;

                    while (this.stakingRewardsTable.lastElementChild) {
                        this.stakingRewardsTable.removeChild(this.stakingRewardsTable.lastElementChild);
                    }

                    for (let n = 0; n < rewards.length; n++) {
                        const stakingRewardRow = stakingRewardRowTemplate.cloneNode(true).content;
                        const rewardData = rewards[n];

                        const transactionDateString = rewardData.timestamp.substring(0, 'yyyy-MM-dd'.length);
                        const conversionRate = convertToCurrency == 'near' ? 1 : await getEODPrice(convertToCurrency, transactionDateString);
                        const convertedEarnings = conversionRate * (rewardData.earnings) / 1e+24;
                        totalEarnings += convertedEarnings;
                        const convertedDeposit = conversionRate * (rewardData.deposit) / 1e+24;
                        const convertedWithdrawal = conversionRate * (rewardData.withdrawal) / 1e+24;

                        stakingRewardRow.querySelector('.stakingrewardrow_datetime').innerHTML = transactionDateString;

                        stakingRewardRow.querySelector('.stakingrewardrow_balance').innerHTML = (conversionRate *
                            (rewardData.balance / 1e+24)
                        ).toFixed(numDecimals);
                        stakingRewardRow.querySelector('.stakingrewardrow_earnings').innerHTML = convertedEarnings.toFixed(numDecimals);
                        stakingRewardRow.querySelector('.stakingrewardrow_deposit').innerHTML = convertedDeposit.toFixed(numDecimals);
                        stakingRewardRow.querySelector('.stakingrewardrow_withdrawal').innerHTML = convertedWithdrawal.toFixed(numDecimals);
                        this.stakingRewardsTable.appendChild(stakingRewardRow);
                    }
                    this.shadowRoot.querySelector('#totalEarnings').innerHTML = totalEarnings.toFixed(numDecimals);

                });
                stakingPoolSelect.appendChild(option);
            });

            const tableElement = this.shadowRoot.querySelector('.table-responsive');
            tableElement.style.height = (window.innerHeight - tableElement.getBoundingClientRect().top) + 'px';
        }
    });