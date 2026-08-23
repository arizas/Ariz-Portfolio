// The browser's locale, as something Intl will actually accept.
//
// `navigator.language` is not guaranteed to be a well-formed BCP-47 tag. A
// Chromium started without a locale reports `en-US@posix`, which Intl rejects
// outright — and an Intl constructor that throws takes the whole panel down with
// it, so the page fails to render rather than falling back to a default format.
//
// Passing `undefined` makes Intl use the runtime default, which is exactly what
// is wanted when the browser cannot name its locale properly.
let cached;

export function browserLocale() {
    if (cached !== undefined) return cached;
    const tag = typeof navigator !== 'undefined' ? navigator.language : undefined;
    cached = isUsableLocale(tag) ? tag : undefined;
    return cached;
}

function isUsableLocale(tag) {
    if (!tag) return false;
    try {
        new Intl.NumberFormat(tag);
        return true;
    } catch {
        return false;
    }
}

/** Test hook: forget the cached answer. */
export function __resetBrowserLocale() {
    cached = undefined;
}
