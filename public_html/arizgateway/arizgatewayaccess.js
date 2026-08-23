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
// A localStorage override lets local dev and the e2e harnesses point the app at
// a local gateway/store without editing this file.
export const arizgatewayhost = globalThis.localStorage?.getItem('ariz_gateway_host_override') ?? 'https://arizgateway.fly.dev';
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
    if (_testWallet) return; // injected test wallet == connected
    const connector = await getConnector();
    await connector.connect(); // opens the wallet-selection modal
}

/**
 * The account id of the CONNECTED wallet, reconnecting (wallet dialog) if the
 * session is gone. A fresh cached bearer token OUTLIVES the wallet session —
 * isSignedIn() stays true and token-only features (API reads, clone command)
 * keep working while the connector is disconnected. Features that need wallet
 * signatures (encrypted-sync key derivation) or the live account id must call
 * this instead of relying on isSignedIn().
 */
export async function requireWalletAccount() {
    let accountId = await getAccountId();
    if (!accountId) {
        await loginToArizGateway();
        accountId = await getAccountId();
    }
    if (!accountId) {
        throw new Error('Not signed in — connect your NEAR wallet to use encrypted sync');
    }
    return accountId;
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

/**
 * How long to wait for the gateway before giving up.
 *
 * A `fetch` with no timeout does not fail, it waits — and a request that never
 * answers takes the page with it. One stalled price lookup froze the portfolio
 * on "Calculating NPRO (3 of 46)" for six minutes with nothing on screen to say
 * why: no error, no pending request the profiler could see, ninety-eight per
 * cent idle. Every caller here already knows how to carry on without an answer,
 * so failing is strictly better than hanging.
 */
export const GATEWAY_TIMEOUT_MILLIS = 30000;

/**
 * Thrown instead of opening a wallet dialog, for callers that must not.
 *
 * A cached bearer token lasts under an hour. When it expires, getAccessToken
 * asks the wallet to sign a new one — which puts a QR code on screen and waits
 * for a phone. That is right for something the user just clicked, and wrong for
 * a price lookup running in the background: the page sat on "Reading NEAR (1 of
 * 46)" while a modal it never mentioned waited to be scanned. Idle, no pending
 * request, no error. I spent a while blaming the gateway for that.
 */
export class SignatureRequiredError extends Error {
    constructor(path) {
        super(`Sign in to the Ariz gateway to load ${path}`);
        this.name = 'SignatureRequiredError';
        this.path = path;
    }
}

/**
 * @param {string} path
 * @param {object} [options]
 * @param {number} [options.timeoutMillis]
 * @param {boolean} [options.interactive] false for work the user did not ask
 *   for just now: use a token that is already valid, or give up saying so,
 *   rather than putting a wallet dialog in front of them
 */
export async function fetchFromArizGateway(path, {
    timeoutMillis = GATEWAY_TIMEOUT_MILLIS, interactive = true,
} = {}) {
    if (!interactive && !cachedTokenIsFresh(readCachedToken())) {
        throw new SignatureRequiredError(path);
    }
    if (!(await isSignedIn())) {
        return {};
    }
    try {
        const arizGatewayAccessToken = await getAccessToken();
        setProgressbarValue('indeterminate', 'Loading data from Ariz gateway');
        const response = await fetch(`${arizgatewayhost}${path}`, {
            headers: { 'authorization': `Bearer ${arizGatewayAccessToken}` },
            signal: timeoutMillis > 0 ? AbortSignal.timeout(timeoutMillis) : undefined
        });
        setProgressbarValue(null);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`${response.status} ${response.statusText}: ${errorText}`);
        }
        return await response.json();
    } catch (e) {
        setProgressbarValue(null);
        // Name the wait, so a timeout does not arrive looking like the token
        // having no price.
        if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
            throw new Error(`Ariz gateway did not answer ${path} within ${timeoutMillis / 1000} s`, { cause: e });
        }
        throw e;
    }
}
