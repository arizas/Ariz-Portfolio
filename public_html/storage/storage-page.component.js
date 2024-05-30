import 'https://cdn.jsdelivr.net/npm/near-api-js@3.0.4/dist/near-api-js.min.js';
import { exists, git_init, git_clone, configure_user, get_remote, set_remote, sync, commit_all, delete_local } from './gitstorage.js';
import wasmgitComponentHtml from './storage-page.component.html.js';
import { modalAlert } from '../ui/modal.js';
import { setProgressbarValue } from '../ui/progress-bar.js';
import { fetchNEARHistoricalPricesFromNearBlocks, fetchNOKPrices, importYahooNEARHistoricalPrices } from '../pricedata/pricedata.js';

const nearconfig = {
    nodeUrl: 'https://rpc.mainnet.near.org',
    walletUrl: 'https://wallet.near.org',
    helperUrl: 'https://helper.mainnet.near.org',
    networkId: 'mainnet',
    contractName: 'wasmgit.near',
    deps: {}
};

export const walletConnectionPromise = new Promise(async resolve => {
    nearconfig.deps.keyStore = new nearApi.keyStores.BrowserLocalStorageKeyStore();
    const near = await nearApi.connect(nearconfig);
    const wc = new nearApi.WalletConnection(near, 'wasmgit');

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

            this.shadowRoot.getElementById('fetchnearusdbutton').addEventListener('click', async () => {
                console.log('click');
                setProgressbarValue('indeterminate', 'Fetching NEAR/USD prices from nearblocks.io');
                await fetchNEARHistoricalPricesFromNearBlocks();
                setProgressbarValue(null);
            });
            this.shadowRoot.getElementById('importnearusdyahoobutton').addEventListener('click', async () => {
                setProgressbarValue('indeterminate', 'Fetching NEAR/USD prices from Yahoo finance');
                const data = await new Promise(resolve => {
                    const fileinput = this.shadowRoot.getElementById('yahoofinancecsvfileinput');
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.readAsText(fileinput.files[0]);
                });
                await importYahooNEARHistoricalPrices(data);
                setProgressbarValue(null);
            });
            this.shadowRoot.getElementById('fetchusdnokbutton').addEventListener('click', async () => {
                setProgressbarValue('indeterminate', 'Fetching USD/NOK rates from Norges Bank');
                await fetchNOKPrices();
                setProgressbarValue(null);
            });

            this.loginbutton = this.shadowRoot.querySelector('#loginbutton');
            this.logoutbutton = this.shadowRoot.querySelector('#logoutbutton');

            this.deletelocaldatabutton = this.shadowRoot.querySelector('#deletelocaldatabutton');

            this.deletelocaldatabutton.addEventListener('click', async () => {
                console.log('delete local data');
                this.deletelocaldatabutton.disabled = true;
                await delete_local();
                location.reload();
            });

            await this.loadAccountData();

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

            if (!currentUser.accountId) {
                return;
            }

            this.shadowRoot.querySelector('#currentuserspan').innerHTML = `Logged in as ${currentUser.accountId}`;

            const accessToken = await createAccessToken();
            configure_user({
                accessToken,
                useremail: currentUser.accountId,
                username: currentUser.accountId
            });
        }
    });