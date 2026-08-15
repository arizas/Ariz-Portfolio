import { expect } from '@playwright/test';
import { setupApiMocks } from './api-mocks.js';

/**
 * Shared driving code for the Transactions page end-to-end tests.
 *
 * The fixture account is the synthetic V2 export in
 * testdata/accountingexport/accounts_tx-page-test.near_download_json.json,
 * with a known mix of NEAR + FT + Intents + staking-pool records.
 */
export const TEST_ACCOUNT = 'tx-page-test.near';

/** Number of records in the fixture that end up as table rows. */
export const TEST_ACCOUNT_ROW_COUNT = 3;

/**
 * Follow a navbar link. At phone widths the navbar is collapsed behind the
 * hamburger button, so it has to be opened first — and the app collapses it
 * again after navigating.
 *
 * Both transitions are animated, and while the menu is open or closing the
 * navbar is several rows tall and pushes the page content down, so wait for
 * each to finish. Bootstrap marks a running transition with `collapsing` and
 * only adds `show` once the menu is fully open.
 *
 * Waiting for `show` before clicking the link is what makes this reliable:
 * Bootstrap's hide() is a no-op while the open transition runs, so a click that
 * lands too early leaves the menu open for the rest of the test. Playwright's
 * own actionability check does not catch it — the container animates its
 * height with the links already at their final positions inside, so the link
 * looks perfectly stable from the first frame.
 */
export async function navigateTo(page, linkName) {
    const navbar = page.locator('app-near-account-report');
    const navbarToggler = navbar.locator('.navbar-toggler');
    const navbarCollapse = navbar.locator('#navbarNavAltMarkup');

    // Decided from the viewport, not from `isVisible()`: that call does not
    // auto-wait, so before the custom element upgrades (or the Bootstrap CSS
    // lands) it just answers "no" — the menu would never be opened and the
    // click below would hang on a link that stays display:none for the rest of
    // the test. The breakpoint is Bootstrap's navbar-expand-md.
    const viewport = page.viewportSize();
    const collapsible = !viewport || viewport.width < 768;

    if (collapsible) {
        // Auto-waits, so it doubles as the "app is up and styled" gate.
        await expect(navbarToggler).toBeVisible();
        await navbarToggler.click();
        await expect(navbarCollapse).toHaveClass(/\bshow\b/);
    }
    // Scoped to the navbar and exact: role-name matching is substring-based
    // across the whole page, and app.spec.js already documents one collision
    // (the landing page's "github.com/arizas/Ariz-Portfolio" link contains
    // "Portfolio").
    await navbar.getByRole('link', { name: linkName, exact: true }).click();
    if (collapsible) {
        await expect(navbarCollapse).toBeHidden();
    }
}

/**
 * Add the fixture account from the Accounts page, load its records from the
 * (mocked) gateway, then open the Transactions page for it.
 */
export async function loadTestAccountAndOpenTransactions(page) {
    await setupApiMocks(page);

    await page.goto('/');

    await navigateTo(page, 'Accounts');
    await page.getByRole('button', { name: 'Add account' }).click();
    await page.getByRole('textbox').fill(TEST_ACCOUNT);
    await page.getByRole('button', { name: 'load from server' }).click();

    const progressbar = page.locator('progress-bar');
    try {
        await progressbar.waitFor({ state: 'visible', timeout: 10_000 });
    } catch {
        // The load may already have finished before we got here.
    }
    // The progress bar is a fixed full-screen overlay, so nothing else is
    // clickable until it is gone.
    await progressbar.waitFor({ state: 'hidden', timeout: 90_000 });
    await page.waitForTimeout(2000);

    await navigateTo(page, 'Transactions');

    const transactionsPage = page.locator('transactions-page');
    const accountSelect = transactionsPage.locator('#accountselect');
    await expect(accountSelect).toBeVisible();
    await accountSelect.selectOption(TEST_ACCOUNT);

    // Wait for the render to settle — rows, or the empty state that says there
    // were none — without judging which. The specs assert the outcome they
    // expect themselves, so a storage regression that renders nothing fails on
    // their explicit checks (and the comments explaining them) instead of
    // timing out anonymously in here.
    await expect(transactionsPage.locator('#transactionstable tr, #emptystate:visible').first())
        .toBeVisible();
}

/** The page component lives inside the app shell's shadow root. */
const PAGE_ROOT = `document.querySelector('app-near-account-report').shadowRoot
    .querySelector('transactions-page').shadowRoot`;

/**
 * Geometry of the table scroll container as it is right now, taken in a single
 * evaluate so the whole snapshot describes one instant.
 *
 * Use this when the test drives the layout itself and wants to assert on
 * whatever came out; use `measureTransactionsTable` when it should first settle.
 */
export function readTransactionsTable(page) {
    return page.evaluate(`(() => {
        const shadowRoot = ${PAGE_ROOT};
        const container = shadowRoot.querySelector('.table-responsive');
        const headerRow = shadowRoot.querySelector('table thead tr');
        const bodyRow = shadowRoot.querySelector('#transactionstable tr');
        const { top, height } = container.getBoundingClientRect();
        return {
            top,
            documentTop: top + window.scrollY,
            scrollY: window.scrollY,
            visibleHeight: height,
            // The raw value the component wrote, before the CSS floor and before
            // the CSSOM's silent rejection of anything invalid (a negative
            // height leaves the previous one in place).
            inlineHeight: parseFloat(container.style.height),
            minHeight: parseFloat(getComputedStyle(container).minHeight) || 0,
            headerHeight: headerRow.getBoundingClientRect().height,
            // 0 when the table is empty — callers check rowCount before dividing
            // by this, so an empty table fails an assertion instead of throwing
            // an untraceable TypeError out of this string eval.
            rowHeight: bodyRow ? bodyRow.getBoundingClientRect().height : 0,
            rowCount: shadowRoot.querySelectorAll('#transactionstable tr').length,
            viewportHeight: window.innerHeight,
            documentScrollHeight: document.documentElement.scrollHeight,
            descriptionOpen: shadowRoot.querySelector('#pagedescription').open,
            documentScrollable: document.documentElement.scrollHeight > window.innerHeight,
        };
    })()`);
}

/**
 * Geometry of the table scroll container once it has settled.
 *
 * The component sizes the container to the space below it, and re-does that
 * whenever the layout above changes — so a measurement taken mid-adjustment
 * catches a new position with the old height. Wait for the height to agree with
 * the position first.
 */
export async function measureTransactionsTable(page) {
    await page.waitForFunction(`(() => {
        const root = ${PAGE_ROOT};
        const container = root.querySelector('.table-responsive');
        if (!container) return false;
        // With no rows the component collapses the container to its content
        // rather than reserving a screenful, so there is no computed height to
        // agree with — wait for the floor to be lifted instead.
        if (!root.querySelector('#transactionstable tr')) {
            return getComputedStyle(container).minHeight === '0px' && !container.style.height;
        }
        const { top, height } = container.getBoundingClientRect();
        // Document coordinates, matching ui/viewport-table-sizer.js — the
        // container keeps the height it would have at scroll position 0.
        const available = Math.max(0, window.innerHeight - (top + window.scrollY));
        const floor = parseFloat(getComputedStyle(container).minHeight) || 0;
        return Math.abs(height - Math.max(available, floor)) < 1;
    })()`, undefined, { timeout: 10_000 })
        // Swallowed on purpose: the assertions below report the numbers that
        // never agreed, which is a far more useful failure than a bare
        // "waitForFunction timed out" at the end of the test's own timeout.
        .catch(() => { });

    const table = await readTransactionsTable(page);
    if (table.rowCount === 0) {
        expect(table.minHeight, 'an empty table should not hold the min-height floor open').toBe(0);
        expect(table.inlineHeight, 'an empty table should not keep a computed height').toBeNaN();
    } else {
        expect(table.visibleHeight, 'the table height should settle to the space below it')
            .toBeCloseTo(Math.max(expectedTableHeight(table), table.minHeight), 0);
    }
    return table;
}

/**
 * The height the component should have written for the state it was measured
 * in: the distance from the table's place in the *document* to the bottom of
 * the screen, never negative.
 *
 * Deliberately compared against the inline value rather than the rendered one —
 * the CSS floor hides both ways of getting this wrong. A height measured from
 * the scrolled-up position is masked while it stays under the floor, and an
 * invalid negative height is masked completely, because the previous value the
 * CSSOM kept is itself at or above the floor.
 */
export function expectedTableHeight(table) {
    return Math.max(0, table.viewportHeight - table.documentTop);
}

/**
 * The bottom of the table has to be reachable: either it is already on screen,
 * or the document has grown far enough past the viewport that scrolling the
 * page brings it into view.
 *
 * Measured against the actual extent, not merely "the document scrolls at all" —
 * a table hanging 60px below a page that happens to scroll 20px is not reachable.
 */
export function expectTableReachable(table) {
    const tableBottom = table.documentTop + table.visibleHeight;
    const reachableBottom = Math.max(table.viewportHeight, table.documentScrollHeight);
    expect(tableBottom).toBeLessThanOrEqual(reachableBottom + 1);
}
