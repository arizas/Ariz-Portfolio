// Fake ServiceWorkerContainer for the encrypted-sync specs (not a spec file
// itself — wtr only runs *.spec.js): register() fails `failures` times before
// succeeding (near.page's transient 400s), the active worker records
// egit-set-key messages and acks on the transferred port like the real SW,
// and the ready registration supports the update()/installing lifecycle.
export function fakeSwContainer({ failures = 0, ack = true, controlled = true, updateInstallsNewVersion = false } = {}) {
    const active = {
        messages: [],
        postMessage(message, transfer) {
            this.messages.push(message);
            if (ack) transfer?.[0]?.postMessage({ type: 'egit-key-set', repoId: message.repoId });
        },
    };
    const registration = {
        active,
        updateCalls: 0,
        installing: null,
        waiting: null,
        async update() {
            this.updateCalls++;
            if (updateInstallsNewVersion && !this.installing) {
                const stateListeners = [];
                this.installing = {
                    state: 'installing',
                    addEventListener(type, listener) { if (type === 'statechange') stateListeners.push(listener); },
                    // Test helper: the new version finishes activating.
                    activate() { this.state = 'activated'; stateListeners.forEach((l) => l()); },
                };
            }
        },
    };
    const listeners = new Map();
    return {
        active,
        registration,
        registerCalls: [],
        controller: controlled ? active : null,
        async register(url, options) {
            this.registerCalls.push({ url, options });
            if (this.registerCalls.length <= failures) {
                throw new TypeError('Failed to register a ServiceWorker: bad HTTP response code (400)');
            }
            return {};
        },
        get ready() { return Promise.resolve(registration); },
        addEventListener(type, listener) { listeners.set(type, listener); },
        // Test helper: simulate the SW claiming the page after activation.
        claim() {
            this.controller = active;
            listeners.get('controllerchange')?.();
        },
    };
}
