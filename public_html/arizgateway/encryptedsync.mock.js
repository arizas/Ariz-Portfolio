// Fake ServiceWorkerContainer for the encrypted-sync specs (not a spec file
// itself — wtr only runs *.spec.js): register() fails `failures` times before
// succeeding (near.page's transient 400s), and the active worker records
// egit-set-key messages and acks on the transferred port like the real SW.
export function fakeSwContainer({ failures = 0, ack = true, controlled = true } = {}) {
    const active = {
        messages: [],
        postMessage(message, transfer) {
            this.messages.push(message);
            if (ack) transfer?.[0]?.postMessage({ type: 'egit-key-set', repoId: message.repoId });
        },
    };
    const listeners = new Map();
    return {
        active,
        registerCalls: [],
        controller: controlled ? active : null,
        async register(url, options) {
            this.registerCalls.push({ url, options });
            if (this.registerCalls.length <= failures) {
                throw new TypeError('Failed to register a ServiceWorker: bad HTTP response code (400)');
            }
            return {};
        },
        get ready() { return Promise.resolve({ active }); },
        addEventListener(type, listener) { listeners.set(type, listener); },
        // Test helper: simulate the SW claiming the page after activation.
        claim() {
            this.controller = active;
            listeners.get('controllerchange')?.();
        },
    };
}
