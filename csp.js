// The Content-Security-Policy the bundle carries, and how it is put into it.
//
// The bundle is one inline module script, and the wallet connector runs each
// wallet in a srcdoc iframe that inherits this policy, so scripts are allowed
// by a nonce rather than by where they come from. The nonce must be new on
// every page load — a fixed one in a public file is no nonce at all — so the
// bundle carries a placeholder and whoever serves it (the Ariz gateway)
// replaces it per request. The placeholder is not valid nonce syntax: a bundle
// served without that step runs no script, rather than running with a nonce
// everyone knows.
//
// It is a <meta> tag, not a header, so it holds wherever the page is served
// from: the gateway, web4, or a domain of its own.

export const CSP_NONCE_PLACEHOLDER = '{{CSP_NONCE}}';

export const contentSecurityPolicy = [
    // Script runs only from a tag carrying this load's nonce, and from what
    // such a script loads itself. Markup that arrives in a token name — an
    // inline handler, a javascript: URL, a <script> or srcdoc — carries no
    // nonce, whatever host it points at. Wasm for git.
    `script-src 'nonce-${CSP_NONCE_PLACEHOLDER}' 'strict-dynamic' 'wasm-unsafe-eval'`,
    // The git worker is a blob; the encrypted sync service worker is /sw.js.
    `worker-src 'self' blob:`,
    // Not a fence: each wallet's code runs inside this policy and talks to its
    // own servers. Keeping script out is what keeps data in.
    `connect-src 'self' https: wss: data: blob:`,
    `img-src 'self' https: data: blob:`,
    // Bootstrap and its icons. Inline style is markup's, and cannot run.
    `style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net`,
    `font-src 'self' https://cdn.jsdelivr.net data:`,
    // Wallets open their own pages in frames (WalletConnect, deep links).
    `frame-src 'self' https:`,
    `default-src 'self'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
].join('; ');

/** The bundle's HTML with every <script> carrying the nonce and the policy first in <head>. */
export function withContentSecurityPolicy(html) {
    const scripts = html.replace(/<script\b(?![^>]*\bnonce=)/g, `<script nonce="${CSP_NONCE_PLACEHOLDER}"`);
    const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">`;
    // After the charset, which must come first, and before any script.
    const withMeta = scripts.replace(/(<meta charset="[^"]*">)/i, `$1${meta}`);
    if (withMeta === scripts) throw new Error('No <meta charset> to place the Content-Security-Policy after');
    return withMeta;
}
