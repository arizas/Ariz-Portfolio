import 'https://cdn.jsdelivr.net/npm/near-api-js@0.44.2/dist/near-api-js.min.js';
import { exists, git_init, git_clone, configure_user, get_remote, set_remote, sync, commit_all } from './gitstorage.js';

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
            this.shadowRoot.innerHTML = await fetch(new URL('wasmgit.component.html', import.meta.url)).then(r => r.text());
            document.querySelectorAll('link').forEach(lnk => this.shadowRoot.appendChild(lnk.cloneNode()));
            this.loginbutton = this.shadowRoot.querySelector('#loginbutton');
            if ((await walletConnectionPromise).getAccountId()) {
                this.loadAccountData();
            } else {
                console.log('no loggedin user');
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
                } catch (e) {
                    console.error(e);
                }
                this.syncbutton.disabled = false;
            });
            return this.shadowRoot;
        }

        async loadAccountData() {
            const walletConnection = await walletConnectionPromise;
            let currentUser = {
                accountId: walletConnection.getAccountId()
            };
            this.loginbutton.style.display = 'none';
            this.shadowRoot.querySelector('#currentuserspan').innerHTML = `Logged in as ${currentUser.accountId}`;

            configure_user({
                accessToken: await createAccessToken(),
                useremail: currentUser.accountId,
                username: currentUser.accountId
            });
        }
    });