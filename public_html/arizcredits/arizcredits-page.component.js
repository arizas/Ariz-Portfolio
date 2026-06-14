import { getAccountId, signAndSendTransaction } from '../arizgateway/arizgatewayaccess.js';
import { callViewFunction } from '../near/rpc.js';
import html from './arizcredits-page.component.html.js';

export const ARIZCREDITS_CONTRACT_ID = 'arizcredits.near';
// The operator the user authorises is the contract account itself (see the
// contract's deduct: operator === current_account_id).
export const OPERATOR_ACCOUNT = ARIZCREDITS_CONTRACT_ID;
export const ARIZ_DECIMALS = 6;
const GAS = '300000000000000'; // 300 Tgas
const HALF_NEAR = '500000000000000000000000'; // 0.5 NEAR — buy_tokens_for_near price

/** Format a raw 6-decimal ARIZ amount (string) as a human-readable number. */
export function formatAriz(raw) {
    const n = BigInt(raw ?? '0');
    const base = 10n ** BigInt(ARIZ_DECIMALS);
    const whole = n / base;
    const frac = (n % base).toString().padStart(ARIZ_DECIMALS, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Parse a human ARIZ amount ("1.5") to a raw 6-decimal integer string. */
export function parseAriz(value) {
    const [w, f = ''] = String(value).trim().split('.');
    const frac = (f + '0'.repeat(ARIZ_DECIMALS)).slice(0, ARIZ_DECIMALS);
    return (BigInt(w || '0') * 10n ** BigInt(ARIZ_DECIMALS) + BigInt(frac || '0')).toString();
}

/** Build a wallet-selector FunctionCall action that dispatches an on-chain JS method. */
export function jsFunctionCall(functionName, extraArgs = {}, deposit = '0') {
    return {
        type: 'FunctionCall',
        params: {
            methodName: 'call_js_func',
            args: { function_name: functionName, ...extraArgs },
            gas: GAS,
            deposit,
        },
    };
}

customElements.define('arizcredits-page',
    class extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this.readyPromise = this.loadHTML();
        }

        async loadHTML() {
            this.shadowRoot.innerHTML = html;
            document.querySelectorAll('link').forEach(lnk => this.shadowRoot.appendChild(lnk.cloneNode()));

            this.shadowRoot.getElementById('buybtn').addEventListener('click', () => this._run(() => this.buy()));
            this.shadowRoot.getElementById('authbtn').addEventListener('click', () => this._run(() => this.authorize()));
            this.shadowRoot.getElementById('revokebtn').addEventListener('click', () => this._run(() => this.revoke()));

            await this.refresh();
            return this.shadowRoot;
        }

        _setError(message) {
            const el = this.shadowRoot.getElementById('ariz-error');
            if (!el) return;
            el.textContent = message || '';
            el.style.display = message ? '' : 'none';
        }

        // Run an action, then refresh; surface errors instead of throwing.
        async _run(action) {
            this._setError('');
            try {
                await action();
                await this.refresh();
            } catch (e) {
                this._setError(e?.message || String(e));
            }
        }

        async refresh() {
            const accountId = await getAccountId();
            const signedout = this.shadowRoot.getElementById('signedout');
            const panel = this.shadowRoot.getElementById('panel');
            if (!accountId) {
                signedout.style.display = '';
                panel.style.display = 'none';
                return;
            }
            signedout.style.display = 'none';
            panel.style.display = '';
            this._accountId = accountId;
            this.shadowRoot.getElementById('acct').textContent = accountId;

            const [balance, auth, spent] = await Promise.all([
                callViewFunction(ARIZCREDITS_CONTRACT_ID, 'ft_balance_of', { account_id: accountId }).catch(() => '0'),
                callViewFunction(ARIZCREDITS_CONTRACT_ID, 'view_js_func', {
                    function_name: 'view_authorisation', user: accountId, operator_account: OPERATOR_ACCOUNT,
                }).catch(() => null),
                callViewFunction(ARIZCREDITS_CONTRACT_ID, 'view_js_func', {
                    function_name: 'view_spent_since_reset', user: accountId, operator_account: OPERATOR_ACCOUNT,
                }).catch(() => '0'),
            ]);

            this.shadowRoot.getElementById('balance').textContent = `${formatAriz(balance)} ARIZ`;
            this.shadowRoot.getElementById('authstatus').textContent = auth
                ? `up to ${formatAriz(auth.max_per_day)} ARIZ/day`
                : 'not authorised';
            this.shadowRoot.getElementById('spent').textContent = `${formatAriz(spent)} ARIZ`;
            this.shadowRoot.getElementById('revokebtn').disabled = !auth;
        }

        async buy() {
            await signAndSendTransaction(ARIZCREDITS_CONTRACT_ID, [jsFunctionCall('buy_tokens_for_near', {}, HALF_NEAR)]);
        }

        async authorize() {
            const value = this.shadowRoot.getElementById('maxperday').value;
            if (!value || Number(value) <= 0) {
                throw new Error('Enter a daily cap greater than 0');
            }
            const max_amount_per_day = parseAriz(value);
            await signAndSendTransaction(ARIZCREDITS_CONTRACT_ID, [
                jsFunctionCall('authorize_deduction', { operator_account: OPERATOR_ACCOUNT, max_amount_per_day }),
            ]);
        }

        async revoke() {
            await signAndSendTransaction(ARIZCREDITS_CONTRACT_ID, [
                jsFunctionCall('revoke_deduction', { operator_account: OPERATOR_ACCOUNT }),
            ]);
        }
    });
