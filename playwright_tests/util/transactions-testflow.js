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

    const collapsible = await navbarToggler.isVisible();
    if (collapsible) {
        await navbarToggler.click();
        await expect(navbarCollapse).toHaveClass(/\bshow\b/);
    }
    await page.getByRole('link', { name: linkName }).click();
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

    const accountSelect = page.locator('transactions-page').locator('#accountselect');
    await expect(accountSelect).toBeVisible();
    await accountSelect.selectOption(TEST_ACCOUNT);
    await expect(page.locator('transactions-page').locator('#transactionstable tr'))
        .toHaveCount(TEST_ACCOUNT_ROW_COUNT);
}

/**
 * Geometry of the table scroll container, measured in viewport coordinates.
 *
 * The component sizes the container to the space below it, and re-does that
 * whenever the layout above changes — so a measurement taken mid-adjustment
 * catches a new position with the old height. Wait for the height to agree with
 * the position first, and take everything, page scrollability included, in a
 * single evaluate so the whole snapshot describes one instant.
 */
export async function measureTransactionsTable(page) {
    // The page component lives inside the app shell's shadow root.
    const pageRoot = `document.querySelector('app-near-account-report').shadowRoot
        .querySelector('transactions-page').shadowRoot`;

    await page.waitForFunction(`(() => {
        const container = ${pageRoot}.querySelector('.table-responsive');
        const { top, height } = container.getBoundingClientRect();
        const available = window.innerHeight - Math.max(0, top);
        const floor = parseFloat(getComputedStyle(container).minHeight) || 0;
        return Math.abs(height - Math.max(available, floor)) < 1;
    })()`);

    return page.evaluate(`(() => {
        const shadowRoot = ${pageRoot};
        const container = shadowRoot.querySelector('.table-responsive');
        const headerRow = shadowRoot.querySelector('table thead tr');
        const bodyRow = shadowRoot.querySelector('#transactionstable tr');
        const { top, height } = container.getBoundingClientRect();
        return {
            top,
            visibleHeight: height,
            headerHeight: headerRow.getBoundingClientRect().height,
            rowHeight: bodyRow.getBoundingClientRect().height,
            viewportHeight: window.innerHeight,
            descriptionOpen: shadowRoot.querySelector('#pagedescription').open,
            documentScrollable: document.documentElement.scrollHeight > window.innerHeight,
        };
    })()`);
}

/**
 * The whole table has to be reachable: either it ends at the bottom of the
 * screen, or it keeps its CSS minimum height and the document has grown past
 * the viewport, so the page itself scrolls down to it.
 */
export function expectTableReachable(table) {
    const fitsOnScreen = table.top + table.visibleHeight <= table.viewportHeight + 1;
    expect(fitsOnScreen || table.documentScrollable).toBe(true);
}
