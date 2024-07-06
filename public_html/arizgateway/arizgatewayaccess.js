import nearApi from 'near-api-js';

const keyStore = new nearApi.keyStores.BrowserLocalStorageKeyStore();
const contractId = 'arizportfolio.testnet';
const ACCESS_TOKEN_SESSION_STORAGE_KEY = 'ariz_gateway_access_token';
export const TOKEN_EXPIRY_MILLIS = 5 * 60 * 1000;

const nearConfig = {
    nodeUrl: 'https://rpc.testnet.near.org',
    walletUrl: 'https://testnet.mynearwallet.com',
    networkId: 'testnet',
    keyStore
};

async function getWalletConnection() {
    const near = await nearApi.connect(nearConfig);
    const walletConnection = new nearApi.WalletConnection(near, 'Ariz portfolio');
    return walletConnection;
}

export async function loginToArizGateway() {
    const walletConnection = await getWalletConnection();
    await walletConnection.requestSignIn({contractId});    
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
        
        const registeredAccountIdForToken = await account.viewFunction({contractId, methodName: 'get_account_id_for_token', args: { token_hash: Array.from(token_hash_bytes) }});
        if (isTokenValidForAccount(registeredAccountIdForToken, token_payload_obj)) {
            return storedAccessToken;
        } else if(registeredAccountIdForToken === account.accountId) {
            return await createAccessToken(token_hash_bytes);
        }
    }
    await createAccessToken();
}

export async function uint8ArrayToBase64(uint8Array) {
    // Create a Blob from the Uint8Array
    const blob = new Blob([uint8Array], { type: 'application/octet-stream' });

    // Create a FileReader to read the Blob as a Data URL
    const reader = new FileReader();

    // Return a promise that resolves when the FileReader finishes reading
    return new Promise((resolve, reject) => {
        // Define the onload event handler
        reader.onload = function(event) {
            // The result is a Data URL, which includes the Base64 encoded string
            const base64String = event.target.result.split(',')[1];
            resolve(base64String);
        };

        // Define the onerror event handler
        reader.onerror = function(error) {
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

    localStorage.setItem(ACCESS_TOKEN_SESSION_STORAGE_KEY, token);
    const args = {
        token_hash: Array.from(tokenHash),
        signature: Array.from(signatureBytes),
        public_key: Array.from(keyPair.getPublicKey().data)
    };

    const account = walletConnection.account();

    if (oldTokenHash) {
        args.old_token_hash = Array.from(oldTokenHash);
        await account.functionCall({
            contractId: 'arizportfolio.testnet',
            methodName: 'replace_token',
            args
        });
    } else {
        await account.functionCall({
            contractId: 'arizportfolio.testnet',
            methodName: 'register_token',
            args,
            attachedDeposit: nearApi.utils.format.parseNearAmount('0.2')
        });
    }
    return token;
}