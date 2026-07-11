import { arizgatewayhost, getAccessToken, getAccountId } from './arizgatewayaccess.js';
import { obtainDek, bytesToHex } from './encryptionkey.js';

// Encrypted gateway sync plumbing (issue #76).
//
// The egit service worker (from the encrypted-git-storage library, served at
// /sw.js by the gateway and by the arizportfolio.near web4 contract) is the
// browser's git-remote-egit: it intercepts wasm-git's smart-HTTP requests to
// <origin>/egit/<account>/… and answers them from the encrypted object store at
// <gateway>/store/me — encrypting/decrypting with the wallet-unlocked master
// key (encryptionkey.js), so the gateway only ever sees ciphertext.
//
// This module registers that service worker and hands it the key + auth via
// the library's `egit-set-key` message. The SW keeps its config in memory
// only, and the NEP-413 bearer token expires — so configureEgitKey() must be
// called before every encrypted sync (it re-sends the current key + a fresh
// token; re-sending replaces the SW-side config).

const SW_URL = '/sw.js';
// near.page intermittently answers transient 400s, which fails the initial
// register() fetch of /sw.js — retry. Already-installed SWs are unaffected.
const REGISTER_ATTEMPTS = 5;
const REGISTER_RETRY_DELAY_MS = 2000;
const ACK_TIMEOUT_MS = 15000;

let _testContainer = null;
/** Test hook: inject a fake ServiceWorkerContainer. Pass null to clear. */
export function __setTestServiceWorkerContainer(container) {
    _testContainer = container;
}
const swContainer = () => _testContainer ?? navigator.serviceWorker;

/**
 * The git remote URL wasm-git should use for encrypted sync: virtual smart-HTTP
 * under this origin, answered by the service worker. The repoId path segment
 * must match the repoId sent in egit-set-key (the signed-in account).
 */
export const encryptedRemoteUrl = (accountId) => `${location.origin}/egit/${accountId}`;

/**
 * Whether this page has been service-worker controlled from the start. After a
 * FIRST-TIME registration the SW claims the page, but workers that already
 * existed (the wasm-git worker is created at module load) stay uncontrolled —
 * their /egit requests would bypass the SW. Callers enabling encrypted sync
 * for the first time should reload the page when this is false.
 */
export function pageIsControlled() {
    return !!swContainer()?.controller;
}

/**
 * Register /sw.js (module SW, scope '/'), retrying transient failures, and
 * resolve with the ready registration (an active service worker). Safe to call
 * repeatedly — re-registering an installed SW is a no-op.
 */
export async function registerEgitServiceWorker({ attempts = REGISTER_ATTEMPTS, retryDelayMs = REGISTER_RETRY_DELAY_MS } = {}) {
    const sw = swContainer();
    if (!sw) {
        throw new Error('This browser does not support service workers, which encrypted sync requires');
    }
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            await sw.register(SW_URL, { type: 'module', scope: '/' });
            return await sw.ready;
        } catch (e) {
            lastError = e;
            if (attempt < attempts) {
                await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            }
        }
    }
    throw new Error(`Could not install the encrypted sync service worker (${attempts} attempts): ${lastError}`);
}

/**
 * Ensure the service worker is registered and configured for the signed-in
 * account: obtain the master key (obtainDek — may throw NeedsEnrollmentError
 * for an unenrolled wallet key), then send `egit-set-key` with the key, the
 * store base URL and a fresh bearer token, and await the SW's ack.
 *
 * Call before every encrypted sync: this refreshes the token and survives
 * service-worker restarts (the SW's config is in-memory only).
 */
export async function configureEgitKey({ attempts, retryDelayMs } = {}) {
    const registration = await registerEgitServiceWorker({ attempts, retryDelayMs });
    const accountId = await getAccountId();
    if (!accountId) {
        throw new Error('Not signed in — sign in with your NEAR account to use encrypted sync');
    }
    const dek = await obtainDek();
    const token = await getAccessToken();

    const channel = new MessageChannel();
    const ack = new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error('The encrypted sync service worker did not acknowledge the key')),
            ACK_TIMEOUT_MS);
        channel.port1.onmessage = (event) => { clearTimeout(timer); resolve(event.data); };
    });
    registration.active.postMessage({
        type: 'egit-set-key',
        repoId: accountId,
        keyHex: bytesToHex(dek),
        storeBaseUrl: `${arizgatewayhost}/store/me`,
        headers: { Authorization: `Bearer ${token}` },
    }, [channel.port2]);
    await ack;
    return { repoId: accountId, remoteUrl: encryptedRemoteUrl(accountId) };
}
