import { getAccountId, signAndSendTransaction } from '../arizgateway/arizgatewayaccess.js';
import {
    ARIZCREDITS_CONTRACT_ID,
    formatAriz,
    parseAriz,
    jsFunctionCall,
    getArizBalance,
    getAuthorisation,
    getSpentSinceReset,
    buyTokensAction,
    authorizeAction,
    revokeAction,
} from './arizcredits.js';
import html from './arizcredits-page.component.html.js';

// Re-export the pure helpers so existing specs importing them from here keep working.
export { formatAriz, parseAriz, jsFunctionCall, ARIZCREDITS_CONTRACT_ID };

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
                getArizBalance(accountId),
                getAuthorisation(accountId),
                getSpentSinceReset(accountId),
            ]);

            this.shadowRoot.getElementById('balance').textContent = `${formatAriz(balance)} ARIZ`;
            this.shadowRoot.getElementById('authstatus').textContent = auth
                ? `up to ${formatAriz(auth.max_per_day)} ARIZ/day`
                : 'not authorised';
            this.shadowRoot.getElementById('spent').textContent = `${formatAriz(spent)} ARIZ`;
            this.shadowRoot.getElementById('revokebtn').disabled = !auth;
        }

        async buy() {
            await signAndSendTransaction(ARIZCREDITS_CONTRACT_ID, [buyTokensAction()]);
        }

        async authorize() {
            const value = this.shadowRoot.getElementById('maxperday').value;
            if (!value || Number(value) <= 0) {
                throw new Error('Enter a daily cap greater than 0');
            }
            await signAndSendTransaction(ARIZCREDITS_CONTRACT_ID, [authorizeAction(parseAriz(value))]);
        }

        async revoke() {
            await signAndSendTransaction(ARIZCREDITS_CONTRACT_ID, [revokeAction()]);
        }
    });
