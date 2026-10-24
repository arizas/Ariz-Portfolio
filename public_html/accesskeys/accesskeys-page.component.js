import { getAccounts, getAccessKeys, refreshAccessKeys, setAccessKeyNotes, findAccessKeyLastUses } from '../storage/domainobjectstore.js';
import { setProgressbarValue } from '../ui/progress-bar.js';
import { getConnectedAccount, signAndSendTransaction } from '../arizgateway/arizgatewayaccess.js';
import { modalAlert, modalYesNo } from '../ui/modal.js';
import html from './accesskeys-page.component.html.js';

const day = (iso) => iso ? iso.substring(0, 'yyyy-MM-dd'.length) : '?';

function shortKey(publicKey) {
    const [curve, key] = publicKey.split(':');
    return `${curve}:${key.substring(0, 6)}…${key.substring(key.length - 4)}`;
}

function describeAccess(permission, cell) {
    const badge = document.createElement('span');
    if (permission.type === 'FullAccess') {
        badge.className = 'badge bg-danger';
        badge.textContent = 'Full access';
        cell.appendChild(badge);
        return;
    }
    badge.className = 'badge bg-secondary';
    badge.textContent = 'Function call';
    const detail = document.createElement('div');
    detail.className = 'small';
    const methods = permission.methodNames.length ? permission.methodNames.join(', ') : 'any method';
    const allowance = permission.allowance === null
        ? 'unlimited fee allowance'
        : `${(Number(BigInt(permission.allowance) / 10n ** 20n) / 10_000).toFixed(4)} NEAR fee allowance`;
    detail.textContent = `${permission.receiverId} · ${methods} · ${allowance}`;
    cell.append(badge, detail);
}

function describeLastUse(observed, cell) {
    if (observed.transactionsSigned === 0) {
        cell.textContent = 'Never';
        return;
    }
    const lastUsed = observed.lastUsed;
    if (lastUsed) {
        const newer = observed.nonce - lastUsed.nonce;
        cell.textContent = newer > 0
            ? `After ${day(lastUsed.at)} (${newer} newer ${newer === 1 ? 'signature' : 'signatures'} not in the fetched history)`
            : day(lastUsed.at);
        cell.title = `Transaction ${lastUsed.txHash}`;
        if (lastUsed.relayer) {
            const via = document.createElement('div');
            via.className = 'small text-muted';
            via.textContent = `via ${lastUsed.relayer}`;
            cell.appendChild(via);
        }
        return;
    }
    cell.textContent = describeLastUseWindow(observed);
}

function describeLastUseWindow(observed) {
    if (observed.lastUseWindow) {
        return `Between ${day(observed.lastUseWindow.from)} and ${day(observed.lastUseWindow.to)}`;
    }
    return `Before ${day(observed.firstSeenAt)}`;
}

// Keys that can sign now come first, full access before function call, newest
// first; removed keys last.
function sortKeys(entries) {
    const rank = ([, { observed }]) =>
        (observed.deletedBetween ? 2 : 0) + (observed.permission.type === 'FullAccess' ? 0 : 1);
    return entries.sort((a, b) => rank(a) - rank(b) || (b[1].observed.addedBlock ?? 0) - (a[1].observed.addedBlock ?? 0));
}

customElements.define('access-keys-page',
    class extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this.readyPromise = this.loadHTML();
        }

        async loadHTML() {
            this.shadowRoot.innerHTML = html;
            document.querySelectorAll('link').forEach(lnk => this.shadowRoot.appendChild(lnk.cloneNode()));

            this.accountSelect = this.shadowRoot.querySelector('#accountselect');
            for (const account of await getAccounts()) {
                const option = document.createElement('option');
                option.value = account;
                option.text = account;
                this.accountSelect.appendChild(option);
            }
            this.accountSelect.addEventListener('change', () => this.showStored());
            this.shadowRoot.querySelector('#refreshbutton').addEventListener('click', () => this.refresh());
            this.shadowRoot.querySelector('#lastusebutton').addEventListener('click', () => this.findLastUses());

            await this.showStored();
            return this.shadowRoot;
        }

        async showStored() {
            this.render(await getAccessKeys(this.accountSelect.value));
        }

        async refresh() {
            const account = this.accountSelect.value;
            const errorElement = this.shadowRoot.querySelector('#error');
            errorElement.hidden = true;
            setProgressbarValue('indeterminate', `Checking the access keys of ${account}`);
            try {
                const accessKeys = await refreshAccessKeys(account);
                if (this.accountSelect.value === account) {
                    this.render(accessKeys);
                }
            } catch (e) {
                errorElement.textContent = e.message;
                errorElement.hidden = false;
            } finally {
                setProgressbarValue(null);
            }
        }

        async findLastUses() {
            const account = this.accountSelect.value;
            const errorElement = this.shadowRoot.querySelector('#error');
            const status = this.shadowRoot.querySelector('#lastusestatus');
            errorElement.hidden = true;
            status.textContent = '';
            try {
                const { accessKeys, looked, unchecked } = await findAccessKeyLastUses(account, {
                    onProgress: (checked, total) => setProgressbarValue(checked / total,
                        `Looking up who signed ${account}'s transactions`, true).stopButtonClicked
                });
                const notFound = Object.values(accessKeys.keys).filter(({ observed }) =>
                    observed && !observed.deletedBetween && observed.transactionsSigned > 0 && !observed.lastUsed).length;
                status.textContent = `Looked up ${looked} transactions.`
                    + (unchecked ? ` ${unchecked} older ones are not checked yet: click again to continue.`
                        : notFound ? ` ${notFound} ${notFound === 1 ? 'key has' : 'keys have'} not signed anything in the fetched history.` : '');
                if (this.accountSelect.value === account) {
                    this.render(accessKeys);
                }
            } catch (e) {
                errorElement.textContent = e.message;
                errorElement.hidden = false;
            } finally {
                setProgressbarValue(null);
            }
        }

        /**
         * Remove a key from the account, after saying what it is and what
         * goes with it. The account itself has to sign a DeleteKey, so the
         * connected wallet must be that account.
         */
        async deleteKey(publicKey) {
            const account = this.accountSelect.value;
            // What the chain says now, not at the last check.
            const accessKeys = await refreshAccessKeys(account);
            this.render(accessKeys);
            const entry = accessKeys.keys[publicKey];
            if (!entry?.observed || entry.observed.deletedBetween) {
                await modalAlert('Already removed', `${publicKey} is no longer a key of ${account}.`);
                return;
            }
            const fullAccessLeft = Object.values(accessKeys.keys).filter(({ observed }) =>
                observed && !observed.deletedBetween && observed.permission.type === 'FullAccess').length;
            if (entry.observed.permission.type === 'FullAccess' && fullAccessLeft <= 1) {
                await modalAlert('The only full access key',
                    `This is the last full access key of ${account}. Removing it would leave no one able to manage the account.`);
                return;
            }
            const connected = await getConnectedAccount();
            if (connected?.accountId !== account) {
                await modalAlert('Sign in as the account',
                    `Only ${account} can remove its own keys. Sign in with a wallet for ${account} and try again.`
                    + (connected ? ` The wallet is now signed in as ${connected.accountId}.` : ''));
                return;
            }

            const { observed, notes } = entry;
            const lines = [
                `Remove this key from ${account}?`,
                '',
                publicKey,
                `Where: ${notes?.label || 'no note'}`,
                `Last used: ${this.shadowRoot.querySelector(`tr[data-publickey="${CSS.escape(publicKey)}"] .keylastused`)?.textContent || '?'}`,
                ''
            ];
            if (connected.publicKey === publicKey) {
                lines.push('This is the key the connected wallet signs with. Once it is removed, that wallet can no longer act for the account.');
            }
            if (observed.permission.type === 'FullAccess') {
                lines.push('A wallet that holds only this key loses the account, and can no longer unlock your encrypted storage.'
                    + ' That is fine as long as another wallet still can.');
            }
            if (!await modalYesNo('Remove access key', lines.join('\n'))) {
                return;
            }
            const errorElement = this.shadowRoot.querySelector('#error');
            errorElement.hidden = true;
            try {
                await signAndSendTransaction(account, [{ type: 'DeleteKey', params: { publicKey } }]);
            } catch (e) {
                errorElement.textContent = `The key was not removed: ${e.message}`;
                errorElement.hidden = false;
                return;
            }
            await this.refresh();
        }

        render(accessKeys) {
            const account = this.accountSelect.value;
            const table = this.shadowRoot.querySelector('#keystable');
            const summary = this.shadowRoot.querySelector('#summary');
            this.shadowRoot.querySelector('#checkedat').textContent = accessKeys?.checkedAt
                ? `Last checked ${day(accessKeys.checkedAt)} (block ${accessKeys.checkedAtBlock})`
                : 'Not checked yet';
            table.replaceChildren();

            const entries = sortKeys(Object.entries(accessKeys?.keys ?? {}).filter(([, entry]) => entry.observed));
            const current = entries.filter(([, { observed }]) => !observed.deletedBetween);
            const fullAccess = current.filter(([, { observed }]) => observed.permission.type === 'FullAccess');
            const unlabelled = fullAccess.filter(([, entry]) => !entry.notes?.label);
            if (!accessKeys?.checkedAt) {
                summary.textContent = '';
            } else if (current.length === 0) {
                summary.textContent = `${account} has no access keys, or does not exist.`;
            } else {
                summary.textContent = `${fullAccess.length} full access and ${current.length - fullAccess.length} function call keys.`
                    + (unlabelled.length ? ` ${unlabelled.length} full access ${unlabelled.length === 1 ? 'key has no note on where it is' : 'keys have no note on where they are'}.` : '');
            }

            const template = this.shadowRoot.querySelector('#keyrowtemplate');
            for (const [publicKey, entry] of entries) {
                const { observed } = entry;
                const row = template.content.cloneNode(true).querySelector('tr');
                row.dataset.publickey = publicKey;
                if (observed.deletedBetween) {
                    row.classList.add('deleted');
                }
                const keyElement = row.querySelector('.publickey');
                keyElement.textContent = shortKey(publicKey);
                keyElement.title = publicKey;

                describeAccess(observed.permission, row.querySelector('.keyaccess'));
                row.querySelector('.keyadded').textContent = observed.addedBlock
                    ? day(observed.addedAt)
                    : 'Unknown (old key)';
                row.querySelector('.keyadded').title = observed.addedBlock ? `Block ${observed.addedBlock}` : '';
                row.querySelector('.keysigned').textContent = observed.transactionsSigned;
                if (observed.deletedBetween) {
                    row.querySelector('.keylastused').textContent =
                        `Removed between ${day(observed.deletedBetween.from)} and ${day(observed.deletedBetween.to)}`;
                } else {
                    describeLastUse(observed, row.querySelector('.keylastused'));
                }

                const label = row.querySelector('.keylabel');
                const text = row.querySelector('.keytext');
                label.value = entry.notes?.label ?? '';
                text.value = entry.notes?.text ?? '';
                const deleteButton = row.querySelector('.keydelete');
                if (observed.deletedBetween) {
                    deleteButton.remove();
                } else if (observed.permission.type === 'FullAccess' && fullAccess.length === 1) {
                    deleteButton.disabled = true;
                    deleteButton.title = 'The only full access key: removing it would leave no one able to manage the account';
                } else {
                    deleteButton.addEventListener('click', () => this.deleteKey(publicKey));
                }
                label.addEventListener('change', () => setAccessKeyNotes(account, publicKey, { label: label.value }));
                text.addEventListener('change', () => setAccessKeyNotes(account, publicKey, { text: text.value }));
                table.appendChild(row);
            }
        }
    });
