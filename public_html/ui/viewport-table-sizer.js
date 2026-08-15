/**
 * Shared sizing for the full-height table scroll containers.
 *
 * Every table page wants the same thing: the scroll container reaches from
 * wherever the chrome above it ends down to the bottom of the screen. That
 * height is only a *lower* bound on what the user can reach — when the chrome
 * leaves less room than the container's CSS `min-height`, the container keeps
 * that minimum, the document grows past the viewport, and the page itself
 * scrolls down to the table.
 */

/**
 * Size `element` so its bottom edge lands at the bottom of the screen when the
 * page is scrolled to the top.
 *
 * Pass `hasContent: false` while there is nothing to show (no selection yet, no
 * records, a filter that matches nothing) — the container then collapses to its
 * content instead of reserving a screen-height blank box under a lone header
 * row.
 */
export function sizeToViewportBottom(element, { hasContent = true } = {}) {
    if (!element) return;

    if (!hasContent) {
        // Inline `min-height` overrides the stylesheet floor; clearing it again
        // hands control back to the stylesheet.
        element.style.height = '';
        element.style.minHeight = '0';
        return;
    }
    element.style.minHeight = '';

    // The top is taken in document coordinates, not viewport coordinates: once
    // the document is tall enough to scroll, a viewport-relative top shrinks as
    // the user scrolls down. Recomputing from it — which happens on every
    // resize, and mobile browsers fire those mid-scroll as the URL bar hides —
    // would grow the container a little further each time and shift the content
    // out from under the reader.
    const documentTop = element.getBoundingClientRect().top + window.scrollY;
    // Clamped: chrome taller than the viewport gives a negative difference, and
    // a negative height is an invalid CSS value that the CSSOM drops silently,
    // leaving the previous — by then stale — height in place.
    const height = Math.max(0, window.innerHeight - documentTop) + 'px';
    // Only write when it actually changes: this runs from a ResizeObserver on
    // the document, and re-setting the height it just settled on would keep the
    // observer firing.
    if (element.style.height !== height) {
        element.style.height = height;
    }
}

/**
 * Call `update` now and whenever the layout may have moved the table, until the
 * returned handle is stopped.
 *
 * `resize` covers rotation as well — `orientationchange` is deprecated and on
 * iOS fires *before* the viewport dimensions update, so it would measure the
 * screen the user just rotated away from.
 *
 * The ResizeObserver catches everything that changes height above the table
 * without changing the window's. The navbar is the case that matters: on mobile
 * it is still animating shut when a page opens from the hamburger menu, so a
 * height measured right then is a couple of hundred pixels short.
 */
export function onViewportLayoutChange(update) {
    window.addEventListener('resize', update);

    const documentObserver = new ResizeObserver(update);
    documentObserver.observe(document.documentElement);

    update();

    return {
        update,
        stop() {
            window.removeEventListener('resize', update);
            documentObserver.disconnect();
        }
    };
}
