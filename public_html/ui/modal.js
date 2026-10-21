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

export async function modal(modalContent) {
    const modalElement = document.createElement('common-modal');
    modalElement.shadowRoot.innerHTML = modalTemplate(modalContent);
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
        <button onclick="getRootNode().result(false)">No</button>
        <button onclick="getRootNode().result(true)">Yes</button>
    </p>`);
}

export async function modalAlert(title, content, { html = false } = {}) {
    return modal(`
    <h3>${escapeHtml(title)}</h3>
    <p>${body(content, html)}</p>
    <p>
        <button onclick="getRootNode().result(true)">Dismiss</button>
    </p>`);
}
