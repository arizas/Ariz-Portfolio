import { arizgatewayhost, getAccessToken, signMessageWithWallet } from './arizgatewayaccess.js';

// Wallet-unlocked master key for the encrypted repository store.
// Design + threat model: docs/encrypted-storage.md ("Your key") and issue #76.
//
// The repo is encrypted with a random master key (DEK), never derived from any
// signature. Each enrolled wallet key unlocks it:
//
//   fixed NEP-413 message ──wallet sign──> deterministic signature
//     ──HKDF──> KEK (unwraps the DEK) + wrapId (where the wrap lives)
//
// The wrap — AES-256-GCM(KEK, DEK) — is stored at /store/me/keys/<wrapId>.
// wrapId is derived from the signature, NOT the public key: access keys are
// public on-chain, so pk-named blobs would let a bucket-level observer map
// stores back to accounts. Only someone who can produce the signature can even
// compute which blob to look for.
//
// Signatures and the DEK live in memory only; nothing key-related is persisted
// in the browser. Wallets with non-deterministic (hedged) ed25519 can't serve
// as a KEK source — enrollment signs twice and compares, and such devices use
// the exported DEK instead.

// Distinct from the auth recipient (arizportfolio.near) so a derivation
// signature can never double as a gateway login token, and vice versa.
const DERIVATION_RECIPIENT = 'encrypted-storage.arizportfolio.near';
const DERIVATION_MESSAGE =
    'Unlock your encrypted Ariz Portfolio storage.\n\n'
    + 'Signing this message derives the key that protects your synced data. '
    + 'Only sign it on arizportfolio.near.page or a client you trust.';
// NEP-413 requires a 32-byte nonce; a FIXED one makes the signature (and thus
// the derived KEK) reproducible across sessions and devices. 32 ASCII bytes:
const DERIVATION_NONCE = new TextEncoder().encode('ariz-encrypted-storage-nonce-v1!');

const HKDF_SALT = new TextEncoder().encode('ariz-egit-salt-v1');
const INFO_KEK = 'ariz-egit-kek-v1';
const INFO_WRAP_ID = 'ariz-egit-wrap-id-v1';

export const DEK_BYTES = 32;
const GCM_IV_BYTES = 12;

/** Thrown when the store already has data but no wrap exists for this wallet
 *  key (or the DEK it unwraps doesn't fit) — the caller must enroll this device
 *  by importing the exported key (or unlocking via an already-enrolled wallet). */
export class NeedsEnrollmentError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NeedsEnrollmentError';
    }
}

/** Thrown when the wallet's signatures over the same message differ — a
 *  hedged/randomized ed25519 signer that can never re-derive its KEK. */
export class NonDeterministicSignerError extends Error {
    constructor() {
        super('This wallet produces a different signature each time, so it cannot unlock the encrypted store by signing. Import your exported key on this device instead.');
        this.name = 'NonDeterministicSignerError';
    }
}

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
export const bytesToHex = (bytes) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
export const hexToBytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], h => parseInt(h, 16));

async function hkdf(ikm, info, length) {
    const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: new TextEncoder().encode(info) },
        key, length * 8);
    return new Uint8Array(bits);
}

/**
 * Sign the fixed derivation message and derive { kek, wrapId }. Signs TWICE and
 * compares: RFC 8032 ed25519 is deterministic, but hedged implementations exist,
 * and a non-deterministic signer would enroll fine and then never be able to
 * unlock again.
 */
export async function deriveKeyMaterial() {
    const sign = () => signMessageWithWallet({
        message: DERIVATION_MESSAGE,
        recipient: DERIVATION_RECIPIENT,
        nonce: DERIVATION_NONCE,
    });
    const first = await sign();
    const second = await sign();
    if (first.signature !== second.signature || first.publicKey !== second.publicKey) {
        throw new NonDeterministicSignerError();
    }
    const ikm = b64ToBytes(first.signature);
    const kek = await hkdf(ikm, INFO_KEK, 32);
    const wrapId = bytesToHex(await hkdf(ikm, INFO_WRAP_ID, 16));
    return { kek, wrapId };
}

async function aesGcm(mode, keyBytes, iv, data) {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [mode]);
    return new Uint8Array(await crypto.subtle[mode]({ name: 'AES-GCM', iv }, key, data));
}

/** AES-256-GCM wrap of the DEK: iv || ciphertext+tag. */
export async function wrapDek(kek, dek) {
    const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
    const ct = await aesGcm('encrypt', kek, iv, dek);
    const out = new Uint8Array(iv.length + ct.length);
    out.set(iv); out.set(ct, iv.length);
    return out;
}

export async function unwrapDek(kek, blob) {
    const bytes = new Uint8Array(blob);
    return aesGcm('decrypt', kek, bytes.subarray(0, GCM_IV_BYTES), bytes.subarray(GCM_IV_BYTES));
}

// --- store access (wraps + repo-existence probe), NEP-413-authenticated -------

async function storeFetch(path, init = {}) {
    const token = await getAccessToken();
    return fetch(`${arizgatewayhost}/store/me${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
    });
}

async function fetchWrap(wrapId) {
    const res = await storeFetch(`/keys/${wrapId}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`fetching key wrap failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
}

async function putWrap(wrapId, blob) {
    const res = await storeFetch(`/keys/${wrapId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: blob,
    });
    if (res.status === 412) return false; // raced — a wrap now exists; caller re-fetches
    if (!res.ok) throw new Error(`storing key wrap failed: ${res.status}`);
    return true;
}

async function repoExists() {
    const res = await storeFetch('/refs');
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`probing encrypted store failed: ${res.status}`);
    return true;
}

// The DEK is held in memory only, for this session.
let _dek = null;

export function currentDek() {
    return _dek;
}

export function currentDekHex() {
    return _dek ? bytesToHex(_dek) : null;
}

export function __clearDekForTests() {
    _dek = null;
}

/**
 * Obtain the DEK for the encrypted store, walking the full enrollment flow:
 *
 *  1. wallet signature -> { kek, wrapId } (deterministic, verified)
 *  2. wrap exists  -> unwrap -> DEK
 *  3. no wrap, repo data exists -> NeedsEnrollmentError (this wallet key isn't
 *     enrolled — import the exported key, or unlock with an enrolled wallet)
 *  4. no wrap, empty store -> FIRST SETUP: mint a random DEK, store the wrap.
 *     Create-only PUT means a concurrent first-setup on another device can't
 *     mint a second DEK for the same wrapId (412 -> re-fetch + unwrap); a race
 *     between DIFFERENT wallet keys is caught at the refs CAS and surfaces as a
 *     manifest that won't decrypt -> NeedsEnrollmentError on the next call.
 */
export async function obtainDek() {
    if (_dek) return _dek;
    const { kek, wrapId } = await deriveKeyMaterial();

    let wrap = await fetchWrap(wrapId);
    if (!wrap) {
        if (await repoExists()) {
            throw new NeedsEnrollmentError(
                'The encrypted store already contains data, but this wallet key is not enrolled. Import your exported key on this device (Storage page) to enroll it.');
        }
        const dek = crypto.getRandomValues(new Uint8Array(DEK_BYTES));
        if (await putWrap(wrapId, await wrapDek(kek, dek))) {
            _dek = dek;
            return _dek;
        }
        wrap = await fetchWrap(wrapId); // lost the race; use the winner's wrap
        if (!wrap) throw new Error('key wrap race lost but no wrap found — retry');
    }
    try {
        _dek = await unwrapDek(kek, wrap);
    } catch {
        throw new NeedsEnrollmentError(
            'The stored key wrap for this wallet could not be opened — enroll this device by importing your exported key (Storage page).');
    }
    return _dek;
}

/**
 * Enroll this device/wallet key with an exported DEK (from another device's
 * "export key"): verifies nothing about the DEK itself here — the first
 * decrypt of the refs manifest is the proof — but stores a wrap so this wallet
 * can unlock by signing from now on.
 */
export async function enrollWithExportedKey(dekHex) {
    const dek = hexToBytes(dekHex.trim());
    if (dek.length !== DEK_BYTES) throw new Error(`the exported key must be ${DEK_BYTES * 2} hex characters`);
    const { kek, wrapId } = await deriveKeyMaterial();
    const stored = await putWrap(wrapId, await wrapDek(kek, dek));
    if (!stored) {
        // A wrap already exists for this wallet key — sanity-check it opens to
        // the same DEK (otherwise the imported key is wrong for this store).
        const existing = await unwrapDek(kek, await fetchWrap(wrapId)).catch(() => null);
        if (!existing || bytesToHex(existing) !== bytesToHex(dek)) {
            throw new Error('a different key is already enrolled for this wallet — the imported key does not match this store');
        }
    }
    _dek = dek;
    return _dek;
}
