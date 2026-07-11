import { setProgressbarValue } from '../ui/progress-bar.js';

// Login + gateway auth via NEP-413 signed messages (@hot-labs/near-connect).
//
// Instead of registering an on-chain access token (the old register_token / 0.2
// NEAR flow), the user signs a NEP-413 message with their wallet. The signed
// message is sent to the gateway as a Bearer token; the gateway verifies the
// signature, recipient, a timestamp window, and that the signing key is a Full
// Access key on the account. See ariz-gateway/server/accesscontrol/nep413.js.

const CONTRACT_ID = 'arizportfolio.near';
// The NEP-413 recipient the gateway expects (it defaults recipient to its
// contract id).
const RECIPIENT = CONTRACT_ID;
export const arizgatewayhost = 'https://arizgateway.fly.dev';
//export const arizgatewayhost = 'http://localhost:15000';
export const ACCESS_TOKEN_SESSION_STORAGE_KEY = 'ariz_gateway_access_token';
// Re-sign before the gateway's NEP-413 validity window (1h) elapses, so a cached
// token is always accepted.
const TOKEN_TTL_MS = 50 * 60 * 1000;

let _connectorPromise = null;
let _testWallet = null; // injected by specs so they don't need a real wallet

/**
 * Test hook: inject a fake wallet (with getAccounts/signMessage/signOut) so
 * specs can exercise the signed-in code paths without a real near-connect
 * session. Pass null to clear.
 */
export function __setTestWallet(wallet) {
    _testWallet = wallet;
}

async function getConnector() {
    if (!_connectorPromise) {
        // Lazy dynamic import so specs that only use the injected test wallet
        // never load the wallet UI library.
        _connectorPromise = import('@hot-labs/near-connect').then(
            ({ NearConnector }) => new NearConnector({ network: 'mainnet' })
        );
    }
    return _connectorPromise;
}

async function currentWallet() {
    if (_testWallet) return _testWallet;
    try {
        const connector = await getConnector();
        return await connector.wallet();
    } catch {
        return null; // not connected
    }
}

async function accountIdFromWallet(wallet) {
    if (!wallet) return null;
    try {
        const accounts = await wallet.getAccounts();
        return accounts?.[0]?.accountId ?? wallet.accountId ?? null;
    } catch {
        return wallet.accountId ?? null;
    }
}

export async function getAccountId() {
    return accountIdFromWallet(await currentWallet());
}

/**
 * NEP-413 signMessage through the connected wallet (or the injected test
 * wallet). Used for gateway auth tokens and for encryption-key derivation
 * (encryptionkey.js) — the latter with its own fixed nonce and a recipient
 * distinct from the auth recipient, so the two signatures can never stand in
 * for each other.
 */
export async function signMessageWithWallet({ message, recipient, nonce }) {
    const wallet = await currentWallet();
    if (!wallet) throw new Error('Not signed in to the Ariz gateway');
    return wallet.signMessage({ message, recipient, nonce });
}

/**
 * Sign and send a transaction through the connected wallet (NEAR Connect).
 * Prompts a login first if not connected. `actions` use the wallet-selector
 * shape, e.g. [{ type: 'FunctionCall', params: { methodName, args, gas, deposit } }].
 */
export async function signAndSendTransaction(receiverId, actions) {
    let wallet = await currentWallet();
    if (!wallet) {
        await loginToArizGateway();
        wallet = await currentWallet();
    }
    if (!wallet) throw new Error('Not signed in to the Ariz gateway');
    return wallet.signAndSendTransaction({ receiverId, actions });
}

export async function loginToArizGateway() {
    const connector = await getConnector();
    await connector.connect(); // opens the wallet-selection modal
}

export async function logout() {
    localStorage.removeItem(ACCESS_TOKEN_SESSION_STORAGE_KEY);
    if (_testWallet) {
        _testWallet = null;
        return;
    }
    try {
        const connector = await getConnector();
        const wallet = await connector.wallet();
        await connector.disconnect(wallet);
    } catch {
        // not connected — nothing to do
    }
}

function readCachedToken() {
    const raw = localStorage.getItem(ACCESS_TOKEN_SESSION_STORAGE_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function cachedTokenIsFresh(cached) {
    return !!(cached && cached.token && cached.issuedAt && (Date.now() - cached.issuedAt) < TOKEN_TTL_MS);
}

export async function isSignedIn() {
    // A fresh cached token implies an active session without touching the wallet.
    if (cachedTokenIsFresh(readCachedToken())) return true;
    return !!(await accountIdFromWallet(await currentWallet()));
}

function bytesToBase64(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
}

function stringToBase64(str) {
    return bytesToBase64(new TextEncoder().encode(str));
}

// Sign a fresh NEP-413 message and cache the resulting bearer token.
async function createAccessToken() {
    const wallet = await currentWallet();
    if (!wallet) throw new Error('Not signed in to the Ariz gateway');

    const issuedAt = Date.now();
    const message = JSON.stringify({ issuedAt });
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const signed = await wallet.signMessage({ message, recipient: RECIPIENT, nonce });

    const payload = {
        accountId: signed.accountId,
        publicKey: signed.publicKey,
        signature: signed.signature, // base64 per NEP-413
        message,
        nonce: bytesToBase64(nonce),
        recipient: RECIPIENT,
    };
    const token = stringToBase64(JSON.stringify(payload));
    localStorage.setItem(
        ACCESS_TOKEN_SESSION_STORAGE_KEY,
        JSON.stringify({ token, accountId: signed.accountId, issuedAt })
    );
    return token;
}

export async function getAccessToken() {
    const cached = readCachedToken();
    if (cachedTokenIsFresh(cached)) return cached.token;

    setProgressbarValue('indeterminate', 'Signing in to the Ariz gateway');
    try {
        return await createAccessToken();
    } finally {
        setProgressbarValue(null);
    }
}

export async function fetchFromArizGateway(path) {
    if (!(await isSignedIn())) {
        return {};
    }
    try {
        const arizGatewayAccessToken = await getAccessToken();
        setProgressbarValue('indeterminate', 'Loading data from Ariz gateway');
        const response = await fetch(`${arizgatewayhost}${path}`, {
            headers: { 'authorization': `Bearer ${arizGatewayAccessToken}` }
        });
        setProgressbarValue(null);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`${response.status} ${response.statusText}: ${errorText}`);
        }
        return await response.json();
    } catch (e) {
        setProgressbarValue(null);
        throw e;
    }
}
