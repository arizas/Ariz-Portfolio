import { arizgatewayhost, getAccessToken, requireWalletAccount } from './arizgatewayaccess.js';
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
 * Resolve once the service worker controls this page (it claims clients on
 * activation, which can land shortly after `ready` resolves). Resolves false on
 * timeout instead of rejecting — the caller's git traffic will then surface a
 * clearer error of its own.
 */
export async function waitForController(timeoutMs = 10000) {
    const sw = swContainer();
    if (sw.controller) return true;
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(!!sw.controller), timeoutMs);
        sw.addEventListener('controllerchange', () => { clearTimeout(timer); resolve(true); }, { once: true });
    });
}

// After an update() check, give a newly fetched SW version this long to
// install + activate before proceeding with whatever is currently active.
const UPDATE_ACTIVATION_TIMEOUT_MS = 15000;

/**
 * A stale INSTALLED service worker keeps answering /egit with old behavior
 * long after a newer /sw.js is deployed (this shipped a v0.1.0 SW that
 * silently dropped the store URL + auth config). update() re-fetches the
 * script bypassing the browser cache; if that yields a new version, wait for
 * it to activate (the SW uses skipWaiting + clients.claim) so the caller
 * configures the CURRENT code, not the stale one. Best-effort: failures fall
 * back to the active worker.
 */
async function pickUpUpdatedServiceWorker(registration) {
    try {
        await registration.update();
    } catch {
        return; // offline / transient — keep the active worker
    }
    const fresh = registration.installing ?? registration.waiting;
    if (!fresh) return;
    await new Promise((resolve) => {
        const timer = setTimeout(resolve, UPDATE_ACTIVATION_TIMEOUT_MS);
        fresh.addEventListener('statechange', () => {
            if (fresh.state === 'activated' || fresh.state === 'redundant') {
                clearTimeout(timer);
                resolve();
            }
        });
    });
}

/**
 * Register /sw.js (module SW, scope '/'), retrying transient failures, and
 * resolve with the ready registration (an active service worker), after
 * picking up a newer deployed /sw.js if there is one. Safe to call
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
            const registration = await sw.ready;
            await pickUpUpdatedServiceWorker(registration);
            return registration;
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
    // Needs the WALLET (key-derivation signatures + account id), not just a
    // fresh cached token — reconnects with the wallet dialog if the session
    // is gone.
    const accountId = await requireWalletAccount();
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
