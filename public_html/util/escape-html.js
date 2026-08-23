/**
 * Escaping text that came from somewhere else before it becomes markup.
 *
 * Most of the strings this app displays are chosen by whoever minted a token.
 * A scam airdrop can put anything in its symbol field — this store holds ones
 * carrying a whole URL, and a sentence, where a ticker should be — and those
 * strings reach the screen whether or not the token has a price, whether or not
 * the user has ever heard of it.
 *
 * Single quotes are escaped too, so a value is safe inside a single-quoted
 * attribute as well as a double-quoted one.
 */
export function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * A value going into a URL, rather than into text.
 *
 * Escaping is not enough here: a transaction hash is put into an href, and one
 * containing `javascript:` or a query separator changes where the link points
 * rather than how it reads.
 */
export function escapeUrlComponent(value) {
    return encodeURIComponent(String(value ?? ''));
}
