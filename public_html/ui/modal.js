import { modalTemplate } from './modal.html.js';
import { escapeHtml } from '../util/escape-html.js';

customElements.define('common-modal',
    class extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({mode: 'open'});
            this.resultPromise = new Promise(resolve => this.shadowRoot.result = resolve);
        }
    });

/**
 * A button with `data-result` resolves the modal: with `results[name](root)`
 * when the caller maps that name, otherwise with the attribute read as JSON.
 * Listeners, not inline onclick: the Content-Security-Policy that keeps an
 * injected handler from running keeps ours from running too.
 */
export async function modal(modalContent, results = {}) {
    const modalElement = document.createElement('common-modal');
    const root = modalElement.shadowRoot;
    root.innerHTML = modalTemplate(modalContent);
    for (const button of root.querySelectorAll('[data-result]')) {
        const name = button.dataset.result;
        button.addEventListener('click', () =>
            root.result(Object.hasOwn(results, name) ? results[name](root) : JSON.parse(name)));
    }
    document.documentElement.appendChild(modalElement);
    const result = await modalElement.resultPromise;
    document.documentElement.removeChild(modalElement);
    return result;
}

/**
 * Text unless the caller says it is markup it built itself, with every value
 * in it escaped. Error messages carry server text, asset ids and account
 * names, none of which are ours to trust.
 */
function body(content, html) {
    return html ? String(content) : escapeHtml(String(content ?? '')).replace(/\n/g, '<br>');
}

export async function modalYesNo(title, question, { html = false } = {}) {
    return modal(`
    <h3>${escapeHtml(title)}</h3>
    <p>${body(question, html)}</p>
    <p>
        <button data-result="false">No</button>
        <button data-result="true">Yes</button>
    </p>`);
}

export async function modalAlert(title, content, { html = false } = {}) {
    return modal(`
    <h3>${escapeHtml(title)}</h3>
    <p>${body(content, html)}</p>
    <p>
        <button data-result="true">Dismiss</button>
    </p>`);
}
