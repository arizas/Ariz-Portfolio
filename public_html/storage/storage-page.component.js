import { exists, git_init, git_clone, configure_user, set_remote, sync, commit_all, delete_local, readdir, push, exportAndDownloadZip, restartGitWorker, gitWorkerControlled } from './gitstorage.js';
import wasmgitComponentHtml from './storage-page.component.html.js';
import { modalAlert } from '../ui/modal.js';
import { setProgressbarValue } from '../ui/progress-bar.js';
import { getAccessToken, getAccountId, isSignedIn, loginToArizGateway, arizgatewayhost } from '../arizgateway/arizgatewayaccess.js';
import { isEncryptedSyncEnabled, setEncryptedSyncEnabled, configureEgitKey, waitForController } from '../arizgateway/encryptedsync.js';
import { obtainDek, currentDekHex, enrollWithExportedKey, NeedsEnrollmentError } from '../arizgateway/encryptionkey.js';

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

// CLI for the ENCRYPTED store: the git-remote-egit helper (bin of the
// encrypted-git-storage package) reads the master key from EGIT_KEY and sends
// EGIT_AUTH as the Authorization header on every store request. The command
// embeds both — the key never reaches the server, but treat the command as a
// secret.
export const egitCloneCommand = (keyHex, token) =>
    `EGIT_KEY=${keyHex} EGIT_AUTH="Bearer ${token}" git clone "egit::${arizgatewayhost}/store/me" portfolio`;

/**
 * Resolve the remote for this sync: the plaintext gateway git server, or — when
 * encrypted sync is enabled — the virtual /egit/<account> remote answered by
 * the service worker, which is registered and given the key + a fresh bearer
 * token here (before EVERY sync: the SW keeps its config in memory only and
 * the token expires). A git worker created before the SW claimed the page is
 * not intercepted (a claim() covers the page, not already-running workers), so
 * it is restarted — gitstorage tracks control at worker creation time.
 */
export async function prepareSyncRemote() {
    if (!isEncryptedSyncEnabled()) return gatewayRepoUrl();
    const { remoteUrl } = await configureEgitKey();
    if (!gitWorkerControlled()) {
        await waitForController();
        await restartGitWorker();
    }
    return remoteUrl;
}

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

            this.shadowRoot.getElementById('enableencryptedsyncbutton')
                .addEventListener('click', () => this.enableEncryptedSync());
            this.shadowRoot.getElementById('disableencryptedsyncbutton')
                .addEventListener('click', () => {
                    setEncryptedSyncEnabled(false);
                    this.refreshEncryptedSyncStatus();
                });
            this.shadowRoot.getElementById('exportkeybutton')
                .addEventListener('click', () => this.exportKey());
            this.shadowRoot.getElementById('importkeybutton')
                .addEventListener('click', () => this.importKey());
            this.shadowRoot.getElementById('copyegitclonebutton')
                .addEventListener('click', () => this.copyEgitCloneCommand());
            this.refreshEncryptedSyncStatus();

            return this.shadowRoot;
        }

        refreshEncryptedSyncStatus() {
            const enabled = isEncryptedSyncEnabled();
            this.shadowRoot.getElementById('encryptedsyncstatus').innerText = enabled ? 'enabled' : 'disabled';
            this.shadowRoot.getElementById('enableencryptedsyncbutton').disabled = enabled;
            this.shadowRoot.getElementById('disableencryptedsyncbutton').disabled = !enabled;
        }

        async enableEncryptedSync() {
            setProgressbarValue('indeterminate', 'enabling encrypted sync');
            try {
                await this.ensureSignedIn();
                // Registers the service worker and unlocks (or first-time
                // creates) the master key — the enable action IS the setup.
                await configureEgitKey();
                setEncryptedSyncEnabled(true);
                setProgressbarValue(null);
                await modalAlert('Encrypted sync enabled',
                    'Your next Synchronize will push to the encrypted store. Export your key now and keep a safe copy — you need it to enroll other devices, and to recover your data if you lose access to this wallet key.');
            } catch (e) {
                setProgressbarValue(null);
                if (e instanceof NeedsEnrollmentError) {
                    await modalAlert('This device needs your exported key', e.message);
                } else {
                    console.error(e);
                    await modalAlert('Could not enable encrypted sync', e);
                }
            }
            this.refreshEncryptedSyncStatus();
        }

        async exportKey() {
            try {
                await this.ensureSignedIn();
                await obtainDek();
                const keyHex = currentDekHex();
                this.shadowRoot.getElementById('exportedkey').textContent = keyHex;
                try { await navigator.clipboard.writeText(keyHex); } catch { /* shown for manual copy */ }
            } catch (e) {
                console.error(e);
                await modalAlert(e instanceof NeedsEnrollmentError ? 'This device needs your exported key' : 'Could not export the key', e.message ?? e);
            }
        }

        async importKey() {
            const input = this.shadowRoot.getElementById('importkeyinput');
            try {
                await this.ensureSignedIn();
                await enrollWithExportedKey(input.value);
                input.value = '';
                setEncryptedSyncEnabled(true);
                await modalAlert('Key imported',
                    'This wallet key is now enrolled: from now on it unlocks the encrypted store by signing, without the exported key.');
            } catch (e) {
                console.error(e);
                await modalAlert('Could not import the key', e.message ?? e);
            }
            this.refreshEncryptedSyncStatus();
        }

        async copyEgitCloneCommand() {
            try {
                await this.ensureSignedIn();
                await obtainDek();
                const cmd = egitCloneCommand(currentDekHex(), await getAccessToken());
                this.shadowRoot.getElementById('egitclonecmd').textContent = cmd;
                try { await navigator.clipboard.writeText(cmd); } catch { /* shown for manual copy */ }
            } catch (e) {
                console.error(e);
                await modalAlert(e instanceof NeedsEnrollmentError ? 'This device needs your exported key' : 'Could not generate the command', e.message ?? e);
            }
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
                // Resolve the remote (and prepare the service worker for
                // encrypted sync) before configuring the worker: a first-time
                // registration restarts the git worker.
                const url = await prepareSyncRemote();
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
