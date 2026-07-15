import { arizgatewayhost, getAccessToken, requireWalletAccount, signMessageWithWallet } from '../arizgateway/arizgatewayaccess.js';
import { callViewFunction } from './rpc.js';

// NEAR Intents confidential transaction history via the 1Click API (issue #75).
//
// Shielded (confidential) balances live in the intents TEE ledger and are
// invisible to every public API — only the account owner can retrieve them, by
// authenticating against 1Click with a wallet-signed NEP-413 message
// (recipient `intents.near`, nonce layout below). The x-api-key needed to open
// the API channel is a gateway secret, fetched from the NEP-413-gated
// `/api/intents/config` endpoint; the history itself goes browser -> 1Click
// directly and never transits the gateway.
//
// Auth/nonce scheme mirrors NEAR-DevHub/trezu nt-be/examples/
// check_confidential_balance.rs, verified end-to-end by
// scripts/intents-history-poc.mjs.

export const INTENTS_CONTRACT_ID = 'intents.near';

/** Confidential history needs ONECLICK_API_KEY configured on the gateway. */
export class ConfidentialHistoryUnavailableError extends Error { }

// ---- module session state (in memory only — mirrors the DEK custody philosophy:
// tokens are never persisted, a page reload re-signs at most once) --------------
let _config = null;   // { apiUrl, apiKey } from the gateway
let _session = null;  // { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt }

export function __resetForTests() {
    _config = null;
    _session = null;
}

/** Test hook: inspect/seed the in-memory 1Click session. */
export function __setSessionForTests(session) {
    _session = session;
}

// ---- base58 (for the ed25519 signature the wallet returns base64-encoded,
// which the 1Click API wants as ed25519:<base58>) -------------------------------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(bytes) {
    let n = 0n;
    for (const b of bytes) n = (n << 8n) | BigInt(b);
    let out = '';
    while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
    for (const b of bytes) { if (b === 0) out = '1' + out; else break; }
    return out;
}

function base64ToBytes(b64) {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToBase64(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
}

function hexToBytes(hex) {
    return Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
}

// ---- NEP-413 payload / salt / nonce -------------------------------------------
export function serializeNep413Payload({ message, nonce, recipient }) {
    const enc = new TextEncoder();
    const str = (s) => {
        const b = enc.encode(s);
        const out = new Uint8Array(4 + b.length);
        new DataView(out.buffer).setUint32(0, b.length, true);
        out.set(b, 4);
        return out;
    };
    const prefix = new Uint8Array(4);
    new DataView(prefix.buffer).setUint32(0, ((1 << 31) + 413) >>> 0, true);
    const parts = [prefix, str(message), nonce, str(recipient), new Uint8Array([0])];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) { out.set(p, offset); offset += p.length; }
    return out;
}

async function fetchIntentsSalt() {
    // current_salt returns a JSON string of 8 hex chars -> 4 salt bytes.
    const hex = await callViewFunction(INTENTS_CONTRACT_ID, 'current_salt', {});
    const salt = hexToBytes(String(hex));
    if (salt.length !== 4) throw new Error(`unexpected intents salt: ${hex}`);
    return salt;
}

// trezu nonce layout: magic 5628F6C6, version 0, 4-byte contract salt,
// deadline ns (LE), created ns (LE), 7 random bytes.
export function buildAuthNonce(salt, deadlineMs, nowMs = Date.now()) {
    const nonce = new Uint8Array(32);
    const view = new DataView(nonce.buffer);
    nonce.set([0x56, 0x28, 0xF6, 0xC6], 0);
    nonce[4] = 0;
    nonce.set(salt, 5);
    view.setBigUint64(9, BigInt(deadlineMs) * 1_000_000n, true);
    view.setBigUint64(17, BigInt(nowMs) * 1_000_000n, true);
    crypto.getRandomValues(nonce.subarray(25, 32));
    return nonce;
}

export async function buildAuthPayload(accountId, { nowMs = Date.now() } = {}) {
    const salt = await fetchIntentsSalt();
    const deadline = new Date(nowMs + 10 * 60_000);
    // The API expects millisecond precision (the wallet signs this exact string).
    const deadlineStr = deadline.toISOString().replace(/(\.\d{3})\d*Z$/, '$1Z');
    const nonce = buildAuthNonce(salt, deadline.getTime(), nowMs);
    // Key order matters: the signature covers this exact string.
    const message = JSON.stringify({ deadline: deadlineStr, intents: [], signer_id: accountId });
    return { message, nonce, recipient: INTENTS_CONTRACT_ID };
}

// ---- gateway config -------------------------------------------------------------
export async function getIntentsApiConfig() {
    if (_config) return _config;
    const token = await getAccessToken();
    const response = await fetch(`${arizgatewayhost}/api/intents/config`, {
        headers: { 'authorization': `Bearer ${token}` },
    });
    if (response.status === 404) {
        throw new ConfidentialHistoryUnavailableError(
            'Confidential intents access is not configured on the gateway'
        );
    }
    if (!response.ok) {
        throw new Error(`intents config -> ${response.status}: ${await response.text()}`);
    }
    _config = await response.json();
    return _config;
}

// ---- 1Click API ------------------------------------------------------------------
async function api(config, path, { method = 'GET', body, bearer } = {}) {
    const headers = { 'x-api-key': config.apiKey };
    if (body) headers['content-type'] = 'application/json';
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    const response = await fetch(config.apiUrl + path, {
        method,
        headers,
        body: body && JSON.stringify(body),
    });
    const text = await response.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
    return { status: response.status, json };
}

function storeSession(authJson) {
    const now = Date.now();
    _session = {
        accessToken: authJson.accessToken,
        refreshToken: authJson.refreshToken,
        // Refresh one minute before expiry so an in-flight pagination never
        // crosses the boundary with a stale token.
        accessExpiresAt: now + (authJson.expiresIn ?? 900) * 1000 - 60_000,
        refreshExpiresAt: now + (authJson.refreshExpiresIn ?? 0) * 1000 - 60_000,
    };
    return _session.accessToken;
}

/** Wallet-signed authentication against the 1Click API (one signature). */
async function authenticate(config) {
    const accountId = await requireWalletAccount();
    const payload = await buildAuthPayload(accountId);
    const signed = await signMessageWithWallet({
        message: payload.message,
        recipient: payload.recipient,
        nonce: payload.nonce,
    });
    const auth = await api(config, '/v0/auth/authenticate', {
        method: 'POST',
        body: {
            signedData: {
                standard: 'nep413',
                payload: {
                    message: payload.message,
                    nonce: bytesToBase64(payload.nonce),
                    recipient: payload.recipient,
                },
                public_key: signed.publicKey,
                // NEP-413 wallets return the signature base64-encoded; the API
                // wants ed25519:<base58>.
                signature: 'ed25519:' + base58Encode(base64ToBytes(signed.signature)),
            },
        },
    });
    if (auth.status !== 200 && auth.status !== 201) {
        throw new Error(`1Click authenticate -> ${auth.status}: ${JSON.stringify(auth.json).slice(0, 300)}`);
    }
    return storeSession(auth.json);
}

/**
 * A valid 1Click access token: cached while fresh, renewed via /v0/auth/refresh
 * while the refresh token lives (~7d), re-signed with the wallet only when the
 * whole session is gone.
 */
async function obtainBearer(config) {
    const now = Date.now();
    if (_session && now < _session.accessExpiresAt) return _session.accessToken;
    if (_session && now < _session.refreshExpiresAt) {
        const refreshed = await api(config, '/v0/auth/refresh', {
            method: 'POST',
            body: { refreshToken: _session.refreshToken },
        });
        if (refreshed.status === 200 || refreshed.status === 201) {
            return storeSession(refreshed.json);
        }
        _session = null; // refresh rejected -> fall through to a fresh signature
    }
    return authenticate(config);
}

// Unique key of a history item — the tuple that identified duplicates when
// unioning the two filtered queries against real data.
export function historyItemKey(item) {
    return `${item.createdAt}|${item.depositAddress}|${item.amountInFormatted}`;
}

async function fetchHistoryPages(config, filter, byKey, { retryDelayMs, maxPages }) {
    let cursor = null;
    for (let page = 0; page < maxPages; page++) {
        const query = `/v0/account/history?limit=50&${filter}` +
            (cursor ? `&nextCursor=${encodeURIComponent(cursor)}` : '');
        // The 1Click backend occasionally 500s ("AMQP Request failed") — retry
        // with backoff before giving up.
        let last;
        for (let attempt = 0; attempt < 5; attempt++) {
            last = await api(config, query, { bearer: await obtainBearer(config) });
            if (last.status < 500) break;
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
        }
        if (last.status !== 200) {
            throw new Error(`1Click history -> ${last.status}: ${JSON.stringify(last.json).slice(0, 300)}`);
        }
        const items = last.json.items ?? [];
        for (const item of items) byKey.set(historyItemKey(item), item);
        cursor = last.json.nextCursor;
        if (!cursor || items.length === 0) break;
    }
}

/**
 * All confidential-related history for the connected wallet account: shieldings
 * (recipientType CONFIDENTIAL_INTENTS), unshieldings (depositType
 * CONFIDENTIAL_INTENTS) and confidential swaps (both). Fetched as the UNION of
 * the two filtered queries — the unfiltered endpoint 500s server-side (bug
 * reported to Defuse), and the union provably covers every movement touching
 * the confidential ledger. Returns items oldest-first.
 */
export async function fetchConfidentialHistory({ retryDelayMs = 1500, maxPages = 100 } = {}) {
    const config = await getIntentsApiConfig();
    const byKey = new Map();
    for (const filter of ['recipientType=CONFIDENTIAL_INTENTS', 'depositType=CONFIDENTIAL_INTENTS']) {
        await fetchHistoryPages(config, filter, byKey, { retryDelayMs, maxPages });
    }
    return [...byKey.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}
