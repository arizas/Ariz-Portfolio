// Everything on this page that came from the model or the store, a token name in
// a script's output included, is shown with textContent and never parsed as markup.
// The policy allows images from any https host, so a markdown or HTML image in the
// model's answer would otherwise send data wherever its URL said.

import html from './ai-assistant-page.component.html.js';
import { NEAR_AI_MODEL, runAgentTurn } from './agent.js';
import { createDataSession } from './data-api.js';
import { checkKey, connectWithWallet, forgetAccount, loadAccount, storeAccount } from './nearai-account.js';
import { verifyModel } from './nearai-attestation.js';
import { createClientKey } from './nearai-e2ee.js';
import { fetchChatModels, privacyStatement } from './nearai-models.js';
import { fetchFromArizGateway } from '../arizgateway/arizgatewayaccess.js';

const DEFAULT_QUESTION = 'What does my data cover, and is anything stale, wrong or missing?';

const MODEL_STORAGE_KEY = 'ariz_nearai_model';
/** NVIDIA's verdict is valid for an hour: a verification older than this is done again before asking. */
const VERIFIED_FOR_MS = 50 * 60 * 1000;
const PRIVACY_CLASS = { checking: 'alert-secondary', private: 'alert-success', 'not-private': 'alert-warning', unsupported: 'alert-warning', failed: 'alert-danger' };

function loadModelChoice() {
    try { return localStorage.getItem(MODEL_STORAGE_KEY) || NEAR_AI_MODEL; } catch { return NEAR_AI_MODEL; }
}

/** The GPU evidence goes to NVIDIA through the Ariz gateway; the browser checks NVIDIA's signed answer. */
async function relayGpuEvidence(payload) {
    const answer = await fetchFromArizGateway('/api/nearai/gpu-attestation', { body: payload, showProgress: false, timeoutMillis: 60000 });
    if (!Array.isArray(answer)) throw new Error('sign in to the Ariz gateway to reach NVIDIA\'s attestation service');
    return answer;
}

const CONNECTION_TEXT = {
    ok: 'Connected to NEAR AI.',
    'no-credits': 'Connected, but this NEAR AI account has no credits. Add them at cloud.near.ai, then ask again.',
    invalid: 'NEAR AI does not accept this key.',
    unknown: 'Connected. NEAR AI could not confirm the key yet.',
};

customElements.define('ai-assistant-page',
    class extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this.shadowRoot.innerHTML = html;
            document.querySelectorAll('link').forEach((link) => this.shadowRoot.appendChild(link.cloneNode()));
            this.session = createDataSession({ onProgress: (message) => this.progress(message) });
            this.messages = [];
            this.notes = [];
            this.element = (id) => this.shadowRoot.getElementById(id);
            this.model = loadModelChoice();
            this.models = [{ id: this.model, name: this.model }];
            this.verifications = new Map();
            this.acknowledged = new Set();
            // This page's own key: the enclave encrypts its answers to it.
            this.client = createClientKey();

            this.element('acknowledge').addEventListener('change', () => {
                if (this.element('acknowledge').checked) this.acknowledged.add(this.model);
                else this.acknowledged.delete(this.model);
                this.refresh();
            });
            this.element('model').addEventListener('change', () => this.chooseModel(this.element('model').value));
            this.element('verify').addEventListener('click', () => this.verifyChosen({ again: true }));
            this.element('connectwallet').addEventListener('click', () => this.run(() => this.connectWallet()));
            this.element('usekey').addEventListener('click', () => this.run(() => this.usePastedKey()));
            this.element('forget').addEventListener('click', () => {
                forgetAccount();
                this.connectionText = null;
                this.refresh();
            });
            this.element('stop').addEventListener('click', () => this.abort?.abort());
            this.element('ask').addEventListener('submit', (event) => {
                event.preventDefault();
                this.run(() => this.ask());
            });
            this.renderModels();
            this.refresh();
            this.loadModels();
            this.verifyChosen();
        }

        async loadModels() {
            try {
                const models = await fetchChatModels();
                this.models = models.some((m) => m.id === this.model) ? models : [{ id: this.model, name: this.model }, ...models];
            } catch (error) {
                console.warn('Could not list NEAR AI models:', error);
            }
            this.renderModels();
        }

        renderModels() {
            const select = this.element('model');
            select.replaceChildren(...this.models.map(({ id, name }) => {
                const option = document.createElement('option');
                option.value = id;
                const result = this.verifications.get(id);
                option.textContent = name + (result ? (result.verified ? ' (verified private)' : result.checks.some((c) => c.unsupported) ? ' (not verifiable here)' : ' (not private)') : '');
                return option;
            }));
            select.value = this.model;
        }

        modelInfo() {
            return this.models.find((m) => m.id === this.model) ?? { id: this.model, name: this.model };
        }

        chooseModel(id) {
            if (id === this.model) return;
            this.model = id;
            try { localStorage.setItem(MODEL_STORAGE_KEY, id); } catch { /* the choice lasts this visit only */ }
            // Nothing said to one model is sent to another.
            this.messages = [];
            this.notes = [];
            if (this.element('transcript').childElementCount > 0) this.addEntry('entry-done', `New conversation with ${this.modelInfo().name}.`);
            this.verifyChosen();
        }

        isFresh(result) {
            return result?.verified && Date.now() - Date.parse(result.verifiedAt) < VERIFIED_FOR_MS;
        }

        async verifyChosen({ again = false } = {}) {
            const model = this.model;
            const known = this.verifications.get(model);
            if (known && !again && (this.isFresh(known) || !known.verified)) return this.renderPrivacy();
            this.verifications.delete(model);
            this.renderPrivacy();
            this.refresh();
            const result = await verifyModel(model, { relayGpu: relayGpuEvidence }).catch((error) => ({
                model, verified: false, signingKey: null, software: {}, verifiedAt: new Date().toISOString(),
                checks: [{ id: 'report', ok: false, label: 'Verification ran', detail: String(error?.message ?? error) }],
            }));
            this.verifications.set(model, result);
            if (model === this.model) {
                this.renderModels();
                this.renderPrivacy();
                this.refresh();
            }
            return result;
        }

        renderPrivacy() {
            const result = this.verifications.get(this.model) ?? null;
            const statement = privacyStatement(this.modelInfo(), result);
            const box = this.element('privacy');
            box.className = `alert mb-0 ${PRIVACY_CLASS[statement.kind]}`;
            this.element('privacytext').textContent = statement.text;
            this.element('checks').hidden = !result;
            this.element('checklist').replaceChildren(...(result?.checks ?? []).map((check) => {
                const item = document.createElement('li');
                item.textContent = `${check.ok ? '✓' : '✗'} ${check.label}${check.informational ? ' (shown, not required)' : ''}${check.detail ? `: ${check.detail}` : ''}`;
                return item;
            }));
            const software = this.element('software');
            software.replaceChildren();
            for (const [where, what] of [['The model enclave runs', result?.software?.model], ['NEAR AI\'s gateway enclave runs', result?.software?.gateway]]) {
                if (!what?.images?.length) continue;
                const line = document.createElement('div');
                line.textContent = `${where}: ${what.images.join(', ')}`;
                software.append(line);
            }
            this.element('acknowledgebox').hidden = !statement.acknowledge;
            this.element('acknowledgelabel').textContent = statement.acknowledge ?? '';
            this.element('acknowledge').checked = this.acknowledged.has(this.model);
        }

        /** Verified now, or the owner accepted that this model is not private. */
        mayAsk() {
            const result = this.verifications.get(this.model);
            return Boolean(result?.verified) || (Boolean(result) && this.acknowledged.has(this.model));
        }

        refresh() {
            const account = loadAccount();
            this.element('connection').textContent = account
                ? (this.connectionText ?? `Connected to NEAR AI${account.accountId ? ` as ${account.accountId}` : ''}.`)
                : 'Connect your NEAR AI account. It uses your own credits, and the browser talks to NEAR AI directly.';
            this.element('forget').hidden = !account;
            this.element('send').disabled = !account || this.busy || !this.mayAsk();
            this.element('stop').hidden = !this.answering;
        }

        async run(action) {
            this.element('error').textContent = '';
            this.busy = true;
            this.refresh();
            try {
                await action();
            } catch (error) {
                if (error?.name !== 'AbortError') this.element('error').textContent = String(error?.message ?? error);
            } finally {
                this.busy = false;
                this.refresh();
            }
        }

        async connectWallet() {
            const account = await connectWithWallet();
            storeAccount(account);
            this.connectionText = CONNECTION_TEXT[account.status];
        }

        async usePastedKey() {
            const key = this.element('pastedkey').value.trim();
            if (!key) return;
            const status = await checkKey(key);
            this.connectionText = CONNECTION_TEXT[status];
            if (status === 'invalid') throw new Error(this.connectionText);
            storeAccount({ key });
            this.element('pastedkey').value = '';
        }

        addEntry(className, text) {
            const entry = document.createElement('div');
            entry.className = `entry ${className}`;
            entry.textContent = text;
            this.element('transcript').append(entry);
            return entry;
        }

        // What is being waited for, and for how long: a step can take a minute,
        // and without this the page looks like it hangs.
        setStatus(text) {
            const status = this.element('status');
            clearInterval(this.statusTimer);
            status.hidden = !text;
            if (!text) return;
            const since = Date.now();
            const show = () => { status.textContent = `${text} (${Math.round((Date.now() - since) / 1000)} s)`; };
            show();
            this.statusTimer = setInterval(show, 1000);
        }

        // From the app, while a step runs: shown as the status, and kept in the
        // step's entry, so what it asked the gateway for can be read afterwards.
        progress(message) {
            this.setStatus(message);
            if (!this.runningStep) return;
            const line = document.createElement('div');
            line.textContent = message;
            this.runningStep.log.append(line);
        }

        // What each step really did, so a finding can be checked against what
        // produced it. Shown as soon as it starts.
        startToolEntry(name, args) {
            const details = document.createElement('details');
            details.className = 'entry entry-tool';
            const summary = document.createElement('summary');
            summary.textContent = `Running ${name}…`;
            const code = document.createElement('pre');
            code.textContent = typeof args?.code === 'string' ? args.code : JSON.stringify(args, null, 1);
            const log = document.createElement('div');
            log.className = 'small text-body-secondary mb-2';
            const output = document.createElement('pre');
            details.append(summary, code, log, output);
            this.element('transcript').append(details);
            this.runningStep = { name, summary, log, output };
            this.setStatus(`Running ${name}`);
        }

        finishToolEntry(name, args, result) {
            if (this.runningStep?.name !== name) this.startToolEntry(name, args);
            this.runningStep.summary.textContent = `Ran ${name}`;
            this.runningStep.output.textContent = result;
            this.runningStep = null;
        }

        async ask() {
            const question = this.element('question').value.trim() || DEFAULT_QUESTION;
            this.element('question').value = '';
            this.addEntry('entry-user', question);
            this.abort = new AbortController();
            this.answering = true;
            this.refresh();
            try {
                // A verification is checked again once NVIDIA's verdict nears its expiry.
                let result = this.verifications.get(this.model);
                if (result?.verified && !this.isFresh(result)) {
                    this.setStatus('Checking the model again');
                    result = await this.verifyChosen({ again: true });
                }
                if (!this.mayAsk()) throw new Error(privacyStatement(this.modelInfo(), result ?? null).text);
                const { answer, messages } = await runAgentTurn({
                    session: this.session,
                    apiKey: loadAccount().key,
                    model: this.model,
                    privacy: result?.verified ? { signingKey: result.signingKey, client: this.client } : null,
                    userMessage: question,
                    messages: this.messages.length ? [...this.messages, ...this.notes.splice(0)] : this.messages,
                    signal: this.abort.signal,
                    onModelCall: (step) => this.setStatus(step === 1 ? 'Waiting for NEAR AI' : `Waiting for NEAR AI (step ${step})`),
                    onToolStart: (name, args) => this.startToolEntry(name, args),
                    onToolResult: (name, args, result) => {
                        this.finishToolEntry(name, args, result);
                        this.renderChanges();
                    },
                });
                this.messages = messages;
                this.addEntry('entry-answer', answer);
            } catch (error) {
                if (error?.status === 402) throw new Error(CONNECTION_TEXT['no-credits']);
                throw error;
            } finally {
                this.answering = false;
                this.runningStep = null;
                this.setStatus(null);
            }
        }

        // Read with the next question, so the assistant knows what happened to
        // what it proposed. Marked as the app's, since the owner did not type it.
        // Queued rather than added to the history: a change can be approved while
        // a turn is still running, and that turn's history replaces this.messages.
        tellAssistant(text) {
            this.notes.push({ role: 'user', content: `[From the app, not typed by the owner: ${text}]` });
        }

        renderChanges() {
            const list = this.element('changelist');
            const changes = this.session.pendingChanges();
            this.element('changes').hidden = changes.length === 0;
            list.replaceChildren(...changes.map((change) => {
                const row = document.createElement('div');
                row.className = 'd-flex flex-wrap gap-2 align-items-center mb-2 pending-change';
                const text = document.createElement('span');
                text.textContent = change.summary;
                const approve = document.createElement('button');
                approve.className = 'btn btn-sm btn-primary approve';
                approve.textContent = 'Approve';
                approve.addEventListener('click', () => this.run(async () => {
                    approve.disabled = true;
                    approve.textContent = 'Working…';
                    try {
                        const result = await this.session.applyChange(change.id);
                        const text = result ? JSON.stringify(result) : 'done';
                        this.addEntry('entry-done', `Done: ${change.summary}. ${text}`);
                        this.tellAssistant(`the owner approved "${change.summary}", and it is done. Result: ${text}`);
                    } catch (error) {
                        this.tellAssistant(`the owner approved "${change.summary}", and it failed: ${error?.message ?? error}`);
                        throw error;
                    } finally {
                        // The action's progress was the status; a running
                        // question sets its own again with its next step.
                        if (!this.answering) this.setStatus(null);
                        this.renderChanges();
                    }
                }));
                const reject = document.createElement('button');
                reject.className = 'btn btn-sm btn-outline-secondary reject';
                reject.textContent = 'Reject';
                reject.addEventListener('click', () => {
                    this.session.rejectChange(change.id);
                    this.tellAssistant(`the owner rejected "${change.summary}"`);
                    this.renderChanges();
                });
                row.append(text, approve, reject);
                return row;
            }));
        }
    });
