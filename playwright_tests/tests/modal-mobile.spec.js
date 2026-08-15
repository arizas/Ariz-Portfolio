import { test, expect } from "@playwright/test";
import { modalTemplate } from "../../public_html/ui/modal.html.js";

// Regression guard for tall dialogs on small screens. The overlay (`:host`) is a
// fixed, full-viewport flexbox that centers `.modaldiv` with `margin: auto`, and
// `.modaldiv` used to have neither a height cap nor scrolling — so a dialog taller
// than the viewport (e.g. "Unlock encrypted sync") had its top and bottom clipped,
// leaving the Cancel/Continue buttons off-screen with no way to scroll to them.
// The overlay is `position: fixed`, so scrolling the document cannot reach them
// either: the modal has to scroll its own content.

/** Content comfortably taller than a phone screen, ending in the action buttons. */
const tallModalContent = /*html*/ `
    <h3>Unlock encrypted sync</h3>
    ${Array.from({ length: 8 }, (_, i) => /*html*/ `<p style="text-align:left">Paragraph ${i + 1}:
        explanatory text of the kind the sync unlock dialog shows before asking the
        wallet to sign, long enough that the dialog outgrows a phone screen.</p>`).join('')}
    <p>
        <button id="modalcancel">Cancel</button>
        <button id="modalcontinue">Continue</button>
    </p>`;

/**
 * Mount the real modal styling the way ui/modal.js does: a shadow-DOM custom
 * element appended to documentElement. A dedicated tag name keeps this
 * independent of whether the app bundle has already defined `common-modal`.
 */
async function openModal(page, content) {
    await page.evaluate((html) => {
        if (!customElements.get('modal-styling-test')) {
            customElements.define('modal-styling-test', class extends HTMLElement {
                constructor() {
                    super();
                    this.attachShadow({ mode: 'open' });
                }
            });
        }
        const modalElement = document.createElement('modal-styling-test');
        modalElement.shadowRoot.innerHTML = html;
        document.documentElement.appendChild(modalElement);
    }, modalTemplate(content));
}

/** Geometry of the mounted modal, measured in viewport coordinates. */
function measureModal(page) {
    return page.evaluate(() => {
        const modaldiv = document.querySelector('modal-styling-test').shadowRoot.querySelector('.modaldiv');
        const { top, bottom } = modaldiv.getBoundingClientRect();
        return {
            top,
            bottom,
            viewportHeight: window.innerHeight,
            overflowsHorizontally: modaldiv.scrollWidth > modaldiv.clientWidth,
        };
    });
}

for (const viewport of [
    { name: 'portrait phone', width: 360, height: 640 },
    { name: 'landscape phone', width: 667, height: 375 },
]) {
    test(`modal buttons stay reachable on a ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto("/");
        await openModal(page, tallModalContent);

        // The dialog must stay inside the viewport instead of extending past both
        // edges — that is what put the buttons out of reach.
        const modal = await measureModal(page);
        expect(modal.top).toBeGreaterThanOrEqual(0);
        expect(modal.bottom).toBeLessThanOrEqual(modal.viewportHeight);
        expect(modal.overflowsHorizontally).toBe(false);

        // Clicking is the real assertion: Playwright scrolls the element into view
        // first, which only succeeds if the modal scrolls its own content. Before
        // the fix this timed out with the button outside the viewport.
        const continueButton = page.locator('modal-styling-test #modalcontinue');
        await continueButton.click();
        await expect(continueButton).toBeInViewport();
    });
}
