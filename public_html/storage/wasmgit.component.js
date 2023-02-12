import 'https://cdn.jsdelivr.net/npm/near-api-js@0.44.2/dist/near-api-js.min.js';
import { exists, git_init, git_clone, configure_user, get_remote, set_remote, sync, commit_all, delete_local } from './gitstorage.js';
import wasmgitComponentHtml from './wasmgit.component.html.js';
import { modalAlert } from '../ui/modal.js';
import { setProgressbarValue } from '../ui/progress-bar.js';

const nearconfig = {
    nodeUrl: 'https://rpc.mainnet.near.org',
    walletUrl: 'https://wallet.near.org',
    helperUrl: 'https://helper.mainnet.near.org',
    contractName: 'wasmgit.near',
    deps: {
        keyStore: new nearApi.keyStores.BrowserLocalStorageKeyStore()
    }
};

export const walletConnectionPromise = new Promise(async resolve => {
    nearconfig.deps.keyStore = new nearApi.keyStores.BrowserLocalStorageKeyStore();
    const near = await nearApi.connect(nearconfig);
    const wc = new nearApi.WalletConnection(near);

    resolve(wc);
});


export async function createAccessToken() {
    const walletConnection = await walletConnectionPromise;
    const accountId = walletConnection.getAccountId();
    const tokenMessage = btoa(JSON.stringify({ accountId: accountId, iat: new Date().getTime() }));
    const signature = await walletConnection.account()
        .connection.signer
        .signMessage(new TextEncoder().encode(tokenMessage), accountId);
    return tokenMessage + '.' + btoa(String.fromCharCode(...signature.signature));
}

export async function login() {
    const walletConnection = await walletConnectionPromise;
    await walletConnection.requestSignIn(
        nearconfig.contractName,
        'WASM-git'
    );
    await loadAccountData();
}

customElements.define('wasm-git-config',
    class extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this.readyPromise = this.loadHTML();
        }

        async loadHTML() {
            this.shadowRoot.innerHTML = wasmgitComponentHtml;
            document.querySelectorAll('link').forEach(lnk => this.shadowRoot.appendChild(lnk.cloneNode()));
            this.loginbutton = this.shadowRoot.querySelector('#loginbutton');
            this.logoutbutton = this.shadowRoot.querySelector('#logoutbutton');

            this.deletelocaldatabutton = this.shadowRoot.querySelector('#deletelocaldatabutton');

            this.deletelocaldatabutton.addEventListener('click', async () => {
                console.log('delete local data');
                this.deletelocaldatabutton.disabled = true;
                await delete_local();
                location.reload();
            });

            if ((await walletConnectionPromise).getAccountId()) {
                this.loadAccountData();
                this.logoutbutton.addEventListener('click', async () => {
                    (await walletConnectionPromise).signOut();
                    console.log('logged out');
                    this.loginbutton.style.display = 'block';
                    this.logoutbutton.style.display = 'none';
                });
            } else {
                console.log('no loggedin user');
                this.logoutbutton.style.display = 'none';
                this.loginbutton.addEventListener('click', async () => {
                    await (await walletConnectionPromise).requestSignIn(
                        nearconfig.contractName,
                        'wasm-git'
                    );
                    this.loadAccountData();
                });
                return;
            }

            this.remoteRepoInput = this.shadowRoot.querySelector('#remoterepo');
            this.remoteRepoInput.addEventListener('change', async () => {
                await set_remote(this.remoteRepoInput.value);
            });

            this.remoteRepoInput.value = await get_remote();
            this.syncbutton = this.shadowRoot.querySelector('#syncbutton');
            this.syncbutton.addEventListener('click', async () => {
                setProgressbarValue('indeterminate', 'syncing with remote');
                try {
                    this.syncbutton.disabled = true;
                    if (!(await exists('.git'))) {
                        if (this.remoteRepoInput.value) {
                            await git_clone(this.remoteRepoInput.value);
                        } else {
                            await git_init();
                        }
                    }
                    await commit_all();
                    await sync();
                    this.dispatchSyncEvent();
                } catch (e) {
                    console.error(e);
                    modalAlert('Error syncing with remote', e);
                }
                setProgressbarValue(null);
                this.syncbutton.disabled = false;
            });
            return this.shadowRoot;
        }

        dispatchSyncEvent() {
            this.dispatchEvent(new Event('sync'));
        }

        async loadAccountData() {
            const walletConnection = await walletConnectionPromise;
            let currentUser = {
                accountId: walletConnection.getAccountId()
            };
            this.loginbutton.style.display = 'none';
            this.shadowRoot.querySelector('#currentuserspan').innerHTML = `Logged in as ${currentUser.accountId}`;

            const accessToken = await createAccessToken();
            configure_user({
                accessToken,
                useremail: currentUser.accountId,
                username: currentUser.accountId
            });
        }
    });