import { exists, git_init, git_clone, configure_user, set_remote, sync, commit_all, delete_local, readdir, push, exportAndDownloadZip } from './gitstorage.js';
import wasmgitComponentHtml from './storage-page.component.html.js';
import { modalAlert } from '../ui/modal.js';
import { setProgressbarValue } from '../ui/progress-bar.js';
import { getAccessToken, getAccountId, isSignedIn, loginToArizGateway, arizgatewayhost } from '../arizgateway/arizgatewayaccess.js';

// One repository per account; the account is implied by the NEP-413 token, so the
// repo name in the URL is a fixed label.
const REPO_NAME = 'portfolio';
export const gatewayRepoUrl = () => `${arizgatewayhost}/git/${REPO_NAME}`;

// CLI helpers: the gateway git server authenticates the same NEP-413 bearer token
// the app uses, passed as an HTTP header. `git -c http.extraHeader=...` is a
// one-shot for cloning; `git config http.extraHeader ...` persists/refreshes it in
// an existing clone (tokens are short-lived).
export const gitCloneCommand = (token) =>
    `git -c http.extraHeader="Authorization: Bearer ${token}" clone ${gatewayRepoUrl()}`;
export const gitConfigCommand = (token) =>
    `git config http.extraHeader "Authorization: Bearer ${token}"`;

customElements.define('storage-page',
    class extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this.readyPromise = this.loadHTML();
        }

        async loadHTML() {
            this.shadowRoot.innerHTML = wasmgitComponentHtml;
            document.querySelectorAll('link').forEach(lnk => this.shadowRoot.appendChild(lnk.cloneNode()));

            this.accountSpan = this.shadowRoot.getElementById('gatewayaccountspan');
            this.refreshAccount();

            this.shadowRoot.getElementById('downloadzipbutton')
                .addEventListener('click', () => exportAndDownloadZip());

            this.deletelocaldatabutton = this.shadowRoot.getElementById('deletelocaldatabutton');
            this.deletelocaldatabutton.addEventListener('click', async () => {
                this.deletelocaldatabutton.disabled = true;
                await delete_local();
                location.reload();
            });

            this.syncbutton = this.shadowRoot.getElementById('syncbutton');
            this.syncbutton.addEventListener('click', () => this.synchronize());

            this.shadowRoot.getElementById('copyclonebutton')
                .addEventListener('click', () => this.copyCommand('clone'));
            this.shadowRoot.getElementById('copyconfigbutton')
                .addEventListener('click', () => this.copyCommand('config'));

            return this.shadowRoot;
        }

        async refreshAccount() {
            let accountId = null;
            try { accountId = await getAccountId(); } catch { /* not signed in */ }
            this.accountSpan.innerText = accountId || '(not signed in)';
        }

        async ensureSignedIn() {
            if (!(await isSignedIn())) {
                await loginToArizGateway();
            }
        }

        dispatchSyncEvent() {
            this.dispatchEvent(new Event('sync'));
        }

        async synchronize() {
            setProgressbarValue('indeterminate', 'syncing with the Ariz gateway');
            this.syncbutton.disabled = true;
            try {
                await this.ensureSignedIn();
                const accessToken = await getAccessToken();
                const accountId = await getAccountId();
                const url = gatewayRepoUrl();
                // Configure the worker's user + bearer token (needed before any
                // network op). git config user.* is best-effort here if there is no
                // repo yet, so it's re-applied once a repo exists below.
                const setUser = () => configure_user({ accessToken, username: accountId, useremail: accountId });

                await setUser();
                this.accountSpan.innerText = accountId || '(not signed in)';

                if (!(await exists('.git'))) {
                    if ((await readdir('.')).length === 2) {
                        // empty local store -> clone the existing repo from the gateway
                        await git_clone(url);
                        await setUser();
                    } else {
                        // existing data, never a repo -> init, commit and first push
                        await git_init();
                        await setUser();
                        await set_remote(url);
                        await commit_all();
                        await push();
                    }
                } else {
                    await setUser();
                    await set_remote(url);
                    await commit_all();
                    await sync();
                }
                this.dispatchSyncEvent();
            } catch (e) {
                console.error(e);
                await modalAlert('Error syncing with the Ariz gateway', e);
            }
            setProgressbarValue(null);
            this.syncbutton.disabled = false;
        }

        async copyCommand(kind) {
            try {
                await this.ensureSignedIn();
                const token = await getAccessToken();
                const cmd = kind === 'clone' ? gitCloneCommand(token) : gitConfigCommand(token);
                this.shadowRoot.getElementById(kind === 'clone' ? 'clonecmd' : 'configcmd').textContent = cmd;
                // Best-effort: the command is shown for manual copy even if the
                // clipboard API is unavailable/blocked.
                try { await navigator.clipboard.writeText(cmd); } catch { /* shown for manual copy */ }
            } catch (e) {
                console.error(e);
                await modalAlert('Could not generate the command', e);
            }
        }
    });
