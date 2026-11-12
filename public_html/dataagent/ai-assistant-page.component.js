// Everything on this page that came from the model or the store, a token name in
// a script's output included, is shown with textContent and never parsed as markup.
// The policy allows images from any https host, so a markdown or HTML image in the
// model's answer would otherwise send data wherever its URL said.

import html from './ai-assistant-page.component.html.js';
import { runAgentTurn } from './agent.js';
import { createDataSession } from './data-api.js';
import { checkKey, connectWithWallet, forgetAccount, loadAccount, storeAccount } from './nearai-account.js';

const DEFAULT_QUESTION = 'What does my data cover, and is anything stale, wrong or missing?';

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

            this.element('acknowledge').addEventListener('change', () => this.refresh());
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
            this.refresh();
        }

        refresh() {
            const account = loadAccount();
            this.element('connection').textContent = account
                ? (this.connectionText ?? `Connected to NEAR AI${account.accountId ? ` as ${account.accountId}` : ''}.`)
                : 'Connect your NEAR AI account. It uses your own credits, and the browser talks to NEAR AI directly.';
            this.element('forget').hidden = !account;
            this.element('send').disabled = !account || this.busy || !this.element('acknowledge').checked;
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
                const { answer, messages } = await runAgentTurn({
                    session: this.session,
                    apiKey: loadAccount().key,
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
