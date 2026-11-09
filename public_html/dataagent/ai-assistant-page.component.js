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
            this.session = createDataSession();
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

        // What each step really did, so a finding can be checked against what produced it.
        addToolEntry(name, args, result) {
            const details = document.createElement('details');
            details.className = 'entry entry-tool';
            const summary = document.createElement('summary');
            summary.textContent = `Ran ${name}`;
            const code = document.createElement('pre');
            code.textContent = typeof args?.code === 'string' ? args.code : JSON.stringify(args, null, 1);
            const output = document.createElement('pre');
            output.textContent = result;
            details.append(summary, code, output);
            this.element('transcript').append(details);
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
                    onToolResult: (name, args, result) => {
                        this.addToolEntry(name, args, result);
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
