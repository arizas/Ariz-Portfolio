import { exists, git_init, git_clone, configure_user, set_remote, sync, commit_all, delete_local, readdir, push, exportAndDownloadZip, restartGitWorker, gitWorkerControlled } from './gitstorage.js';
import wasmgitComponentHtml from './storage-page.component.html.js';
import { modal, modalAlert } from '../ui/modal.js';
import { setProgressbarValue } from '../ui/progress-bar.js';
import { getAccessToken, getAccountId, isSignedIn, loginToArizGateway, requireWalletAccount, arizgatewayhost } from '../arizgateway/arizgatewayaccess.js';
import { configureEgitKey, waitForController } from '../arizgateway/encryptedsync.js';
import {
    obtainDek, currentDek, currentDekHex, enrollWithExportedKey, NeedsEnrollmentError,
    persistCurrentDek, loadPersistedDek, hasPersistedDek, forgetPersistedDek,
} from '../arizgateway/encryptionkey.js';

// CLI for the encrypted store: the git-remote-egit helper (bin of the
// encrypted-git-storage package) reads the master key from EGIT_KEY and sends
// EGIT_AUTH as the Authorization header on every store request. The command
// embeds both — the key never reaches the server, but treat the command as a
// secret.
export const egitCloneCommand = (keyHex, token) =>
    `EGIT_KEY=${keyHex} EGIT_AUTH="Bearer ${token}" git clone "egit::${arizgatewayhost}/store/me" portfolio`;

// Configure an EXISTING local repo instead of cloning: adds (or repoints) an
// `ariz` remote and stores the credentials in the repo's .git/config, where
// git-remote-egit (>= 0.1.5) reads them when EGIT_KEY/EGIT_AUTH are not set —
// after this, plain `git pull ariz master` works. The key stays valid; the
// bearer token expires after ~1h, so re-copy and rerun to refresh it. Same
// secrecy caveat as the clone command: .git/config then holds your key.
export const egitRemoteCommand = (keyHex, token) =>
    `git remote add ariz "egit::${arizgatewayhost}/store/me" 2>/dev/null`
    + ` || git remote set-url ariz "egit::${arizgatewayhost}/store/me";`
    + ` git config egit.key ${keyHex} && git config egit.auth "Bearer ${token}"`;

/**
 * The pre-signature explainer shown before the first key unlock of a session:
 * says WHY the wallet will prompt for the same message twice, and offers to
 * remember the unlocked key on this device (with the shared-computer caveat).
 * Resolves { proceed, remember }.
 */
export async function syncUnlockPrompt() {
    return modal(/*html*/`
    <h3>Unlock encrypted sync</h3>
    <p style="text-align:left">Synchronizing uses your master key, which your wallet unlocks by signing a fixed
        message. Your wallet will ask you to sign the <b>same message twice</b>: the second signature
        confirms your wallet signs deterministically, so the very same key can be unlocked again next
        time. If your gateway session has expired you may get one more sign-in prompt.</p>
    <p style="text-align:left"><label><input type="checkbox" id="rememberdekcheckbox" />
        Remember the unlocked key on this device &mdash; future syncs need no signatures.</label><br/>
        <small>Anyone with access to this browser profile could read the stored key.
        Do not enable this on a shared computer.</small></p>
    <p>
        <button onclick="getRootNode().result({ proceed: false })">Cancel</button>
        <button onclick="getRootNode().result({ proceed: true, remember: getRootNode().getElementById('rememberdekcheckbox').checked })">Continue</button>
    </p>`);
}

/**
 * Make sure the DEK is available before a sync, prompting only when a wallet
 * unlock (signatures) is actually about to happen: an in-memory or on-device
 * key skips the modal entirely.
 * Resolves { proceed, remember, prompted }.
 */
export async function ensureDekUnlockDecision(accountId) {
    if (currentDek() || (accountId && await loadPersistedDek(accountId))) {
        return { proceed: true, remember: false, prompted: false };
    }
    const choice = await syncUnlockPrompt();
    return { proceed: !!choice?.proceed, remember: !!choice?.remember, prompted: true };
}

/**
 * Prepare the sync remote: the virtual /egit/<account> remote answered by the
 * service worker, which is registered and given the key + a fresh bearer token
 * here (before EVERY sync: the SW keeps its config in memory only and the
 * token expires). Encrypted sync is the ONLY sync — plaintext /git hosting is
 * retired (410 on the gateway). A git worker created before the SW claimed the
 * page is not intercepted (a claim() covers the page, not already-running
 * workers), so it is restarted — gitstorage tracks control at worker creation.
 */
export async function prepareSyncRemote() {
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

            this.shadowRoot.getElementById('exportkeybutton')
                .addEventListener('click', () => this.exportKey());
            this.shadowRoot.getElementById('importkeybutton')
                .addEventListener('click', () => this.importKey());
            this.shadowRoot.getElementById('copyegitclonebutton')
                .addEventListener('click', () => this.copyEgitCloneCommand());
            this.shadowRoot.getElementById('copyegitremotebutton')
                .addEventListener('click', () => this.copyEgitRemoteCommand());
            this.shadowRoot.getElementById('forgetkeybutton')
                .addEventListener('click', () => this.forgetStoredKey());
            this.refreshStoredKeyStatus();

            return this.shadowRoot;
        }

        /** Show the "key stored on this device" line only when one is stored. */
        async refreshStoredKeyStatus() {
            let stored = false;
            try {
                const accountId = await getAccountId();
                stored = accountId ? await hasPersistedDek(accountId) : false;
            } catch { /* not signed in */ }
            this.shadowRoot.getElementById('storedkeystatus').style.display = stored ? '' : 'none';
        }

        async forgetStoredKey() {
            try {
                const accountId = await getAccountId();
                if (accountId) await forgetPersistedDek(accountId);
            } finally {
                await this.refreshStoredKeyStatus();
            }
        }

        async exportKey() {
            try {
                await this.requireWallet();
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
                await this.requireWallet();
                await enrollWithExportedKey(input.value);
                input.value = '';
                await modalAlert('Key imported',
                    'This wallet key is now enrolled: from now on it unlocks the encrypted store by signing, without the exported key.');
            } catch (e) {
                console.error(e);
                await modalAlert('Could not import the key', e.message ?? e);
            }
        }

        async copyEgitCloneCommand() {
            try {
                await this.requireWallet();
                await obtainDek();
                const cmd = egitCloneCommand(currentDekHex(), await getAccessToken());
                this.shadowRoot.getElementById('egitclonecmd').textContent = cmd;
                try { await navigator.clipboard.writeText(cmd); } catch { /* shown for manual copy */ }
            } catch (e) {
                console.error(e);
                await modalAlert(e instanceof NeedsEnrollmentError ? 'This device needs your exported key' : 'Could not generate the command', e.message ?? e);
            }
        }

        async copyEgitRemoteCommand() {
            try {
                await this.requireWallet();
                await obtainDek();
                const cmd = egitRemoteCommand(currentDekHex(), await getAccessToken());
                this.shadowRoot.getElementById('egitremotecmd').textContent = cmd;
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

        // The encrypted-sync features sign with the WALLET; a fresh cached
        // token is not enough (it outlives the wallet session). Reconnects
        // via the wallet dialog when needed, then syncs the account display.
        async requireWallet() {
            await requireWalletAccount();
            await this.refreshAccount();
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
                // First unlock of a session: explain the double signature
                // before the wallet starts prompting, and offer to remember
                // the key on this device. Skipped when the key is already in
                // memory or stored (then there is nothing to sign).
                const unlock = await ensureDekUnlockDecision(accountId);
                if (!unlock.proceed) return;
                // Resolve the remote (and prepare the service worker for
                // encrypted sync) before configuring the worker: a first-time
                // registration restarts the git worker.
                const url = await prepareSyncRemote();
                if (unlock.remember && accountId) {
                    // The unlock succeeded (prepareSyncRemote obtained the
                    // DEK) — store it now, as the user asked.
                    await persistCurrentDek(accountId);
                    await this.refreshStoredKeyStatus();
                }
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
            } finally {
                setProgressbarValue(null);
                this.syncbutton.disabled = false;
            }
        }
    });
