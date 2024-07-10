import nearApi from 'near-api-js';
import { modalAlert, modalYesNo } from '../ui/modal.js';
import { setProgressbarValue } from '../ui/progress-bar.js';

const keyStore = new nearApi.keyStores.BrowserLocalStorageKeyStore();
const contractId = 'arizportfolio.near';
const ACCESS_TOKEN_SESSION_STORAGE_KEY = 'ariz_gateway_access_token';
export const TOKEN_EXPIRY_MILLIS = 5 * 60 * 1000;
const arizgatewayhost = 'https://arizgateway.azurewebsites.net';
//const arizgatewayhost = 'http://localhost:15000';


const nearConfig = {
    nodeUrl: 'https://rpc.mainnet.near.org',
    walletUrl: 'https://app.mynearwallet.com',
    networkId: 'mainnet',
    keyStore
};

async function getWalletConnection() {
    const near = await nearApi.connect(nearConfig);
    const walletConnection = new nearApi.WalletConnection(near, 'Ariz portfolio');
    return walletConnection;
}

export async function loginToArizGateway() {
    if (await modalYesNo('Login to Ariz gateway', `
        By logging in to the Ariz gateway, you will get access to conversion rates for many currencies.
        If you click "yes", you will be redirected to <b>MyNearWallet</b> for signing into the Ariz Portfolio contract. After signing in
        you will be prompted to pay 0.2 NEAR for registering an access token to the Ariz gateway on this device. The access token
        will be valid in 5 minutes, and will have to be renewed if requesting more data from the Ariz gateway. The renewal cost is only the gas
        for the smart contract call.
    `)) {
        const walletConnection = await getWalletConnection();
        await walletConnection.requestSignIn({ contractId, successUrl: location.origin, failureUrl: location.origin });
    }
}

export async function isSignedIn() {
    const walletConnection = await getWalletConnection();
    return walletConnection.isSignedIn();
}

export async function logout() {
    const walletConnection = await getWalletConnection();
    return walletConnection.signOut();
}

export function isTokenValidForAccount(accountId, tokenPayload) {
    return accountId == tokenPayload.accountId && tokenPayload.iat <= new Date().getTime() &&
        tokenPayload.iat > (new Date().getTime() - TOKEN_EXPIRY_MILLIS)
}

export async function getAccessToken() {
    const storedAccessToken = localStorage.getItem(ACCESS_TOKEN_SESSION_STORAGE_KEY);
    if (storedAccessToken) {
        const walletConnection = await getWalletConnection();
        const account = walletConnection.account();
        const token_parts = storedAccessToken.split('.');
        const token_payload = atob(token_parts[0], 'base64');
        const token_payload_obj = JSON.parse(token_payload);

        const token_payload_bytes = new TextEncoder().encode(token_payload);
        const token_hash_bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", token_payload_bytes))

        const registeredAccountIdForToken = await account.viewFunction({ contractId, methodName: 'get_account_id_for_token', args: { token_hash: Array.from(token_hash_bytes) } });
        if (isTokenValidForAccount(registeredAccountIdForToken, token_payload_obj)) {
            return storedAccessToken;
        } else if (registeredAccountIdForToken === account.accountId) {
            setProgressbarValue('indeterminate', 'Renewing Ariz gateway access token');
            const renewedAccessToken = await createAccessToken(token_hash_bytes);
            setProgressbarValue(null);
            return renewedAccessToken;
        }
    }
    setProgressbarValue('indeterminate', 'Create Ariz gateway access token');
    await createAccessToken();
    setProgressbarValue(null);
}

export async function uint8ArrayToBase64(uint8Array) {
    // Create a Blob from the Uint8Array
    const blob = new Blob([uint8Array], { type: 'application/octet-stream' });

    // Create a FileReader to read the Blob as a Data URL
    const reader = new FileReader();

    // Return a promise that resolves when the FileReader finishes reading
    return new Promise((resolve, reject) => {
        // Define the onload event handler
        reader.onload = function (event) {
            // The result is a Data URL, which includes the Base64 encoded string
            const base64String = event.target.result.split(',')[1];
            resolve(base64String);
        };

        // Define the onerror event handler
        reader.onerror = function (error) {
            reject(error);
        };

        // Read the Blob as a Data URL
        reader.readAsDataURL(blob);
    });
}

export async function createAccessToken(oldTokenHash) {
    const walletConnection = await getWalletConnection();
    const accountId = walletConnection.getAccountId();

    const keyPair = await keyStore.getKey(nearConfig.networkId, accountId);

    const tokenPayload = JSON.stringify({ iat: new Date().getTime(), accountId, publicKey: keyPair.getPublicKey().toString() });
    const tokenBytes = new TextEncoder().encode(tokenPayload);
    const tokenHash = new Uint8Array(await crypto.subtle.digest("SHA-256", tokenBytes));

    const signatureObj = await keyPair.sign(tokenHash);

    const signatureBytes = signatureObj.signature;
    const token = `${await uint8ArrayToBase64(tokenBytes)}.${await uint8ArrayToBase64(signatureBytes)}`;

    const args = {
        token_hash: Array.from(tokenHash),
        signature: Array.from(signatureBytes),
        public_key: Array.from(keyPair.getPublicKey().data)
    };

    const account = walletConnection.account();

    if (oldTokenHash) {
        args.old_token_hash = Array.from(oldTokenHash);
        args.new_token_hash = args.token_hash;
        try {
            await account.functionCall({
                contractId: contractId,
                methodName: 'replace_token',
                args
            });
            localStorage.setItem(ACCESS_TOKEN_SESSION_STORAGE_KEY, token);
        } catch (e) {
            if (await modalYesNo('Error renewing token', `<p>There was a problem renewing your access token:</p>
                ${e.message}
                <p>
                Do you want to delete the existing access token, so that a new will be registered on the next attempt (costs 0.2 NEAR) ?
                </p>`)
            ) {
                localStorage.removeItem(ACCESS_TOKEN_SESSION_STORAGE_KEY);
            }
        }
    } else {
        localStorage.setItem(ACCESS_TOKEN_SESSION_STORAGE_KEY, token);
        await account.functionCall({
            contractId: contractId,
            methodName: 'register_token',
            args,
            attachedDeposit: nearApi.utils.format.parseNearAmount('0.2')
        });
    }
    return token;
}

export async function fetchFromArizGateway(path) {
    if (await isSignedIn()) {
        const arizGatewayAccessToken = await getAccessToken();
        setProgressbarValue('indeterminate', 'Loading data from Ariz gateway');
        const result = await fetch(`${arizgatewayhost}${path}`, {
            headers: {
                "authorization": `Bearer ${arizGatewayAccessToken}`
            }
        }).then(r => r.json());
        setProgressbarValue(null);
        return result;
    } else {
        return {};
    }
}