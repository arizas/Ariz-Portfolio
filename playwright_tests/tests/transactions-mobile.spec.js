import { test, expect } from '@playwright/test';
import {
    loadTestAccountAndOpenTransactions,
    measureTransactionsTable,
    expectTableReachable,
    expectedTableHeight,
    readTransactionsTable,
    navigateTo,
} from '../util/transactions-testflow.js';
import { setupApiMocks } from '../util/api-mocks.js';

/**
 * Mobile layout guard for the Transactions page.
 *
 * On a phone the page chrome — title, the long description paragraph and the
 * two full-width filter selects — pushed the table so far down that only about
 * two rows were visible, and since the table was sized to exactly fill the rest
 * of the screen the document never grew past the viewport, so there was nothing
 * to scroll vertically either. The table has to start high enough up that a
 * usable number of rows fits on screen.
 */

for (const viewport of [
    { name: 'portrait phone', width: 390, height: 844 },
    { name: 'small portrait phone', width: 360, height: 640 },
]) {
    test(`transactions table starts high up on a ${viewport.name}`, async ({ page }) => {
        test.setTimeout(120_000);

        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await loadTestAccountAndOpenTransactions(page);

        await page.screenshot({
            path: `test-results/transactions-page-${viewport.width}x${viewport.height}.png`,
        });

        const table = await measureTransactionsTable(page);

        // The description is collapsed at phone widths — that is most of the
        // vertical space the chrome used to take.
        expect(table.descriptionOpen).toBe(false);

        // The table has to begin in the top half of the screen, otherwise there
        // is no room left for a useful number of rows.
        expect(table.top).toBeLessThan(table.viewportHeight * 0.5);

        // Room for the header plus a screenful of rows, not just two. Guard the
        // divisor first: with no rows rendered, rowHeight is 0 and the row count
        // below would come out as Infinity and pass on nothing at all.
        expect(table.rowCount).toBeGreaterThan(0);
        const visibleRows = (table.visibleHeight - table.headerHeight) / table.rowHeight;
        expect(visibleRows).toBeGreaterThanOrEqual(6);

        expectTableReachable(table);
    });
}

test('expanding the description resizes the table, collapsing it restores the height', async ({ page }) => {
    test.setTimeout(120_000);

    await page.setViewportSize({ width: 390, height: 844 });
    await loadTestAccountAndOpenTransactions(page);

    const description = page.locator('transactions-page').locator('#pagedescription');
    await expect(description).toHaveJSProperty('open', false);
    const collapsed = await measureTransactionsTable(page);

    // Reading the description is still possible on a phone, and the table
    // resizes around it instead of keeping a stale height.
    await description.locator('summary').click();
    await expect(description).toHaveJSProperty('open', true);

    const expanded = await measureTransactionsTable(page);
    expect(expanded.top).toBeGreaterThan(collapsed.top);
    expectTableReachable(expanded);

    await description.locator('summary').click();
    await expect(description).toHaveJSProperty('open', false);

    const recollapsed = await measureTransactionsTable(page);
    expect(Math.abs(recollapsed.top - collapsed.top)).toBeLessThan(2);
    expect(Math.abs(recollapsed.visibleHeight - collapsed.visibleHeight)).toBeLessThan(2);
});

test('rotating to landscape resizes the table to the new viewport', async ({ page }) => {
    test.setTimeout(120_000);

    await page.setViewportSize({ width: 390, height: 844 });
    await loadTestAccountAndOpenTransactions(page);
    const portrait = await measureTransactionsTable(page);

    // A viewport change is exactly what a rotation delivers to the page: a
    // `resize` event with the new dimensions. (The deprecated
    // `orientationchange` is not used — on iOS it fires *before* innerHeight
    // updates, so a height computed from it describes the old orientation.)
    await page.setViewportSize({ width: 844, height: 390 });
    const landscape = await measureTransactionsTable(page);

    // The height used to be computed once at render time, so after a rotation
    // the table kept its portrait height and hung far below the screen.
    expect(landscape.visibleHeight).toBeLessThan(portrait.visibleHeight);
    expectTableReachable(landscape);
});

test('a resize while the page is scrolled sizes the table from its place in the document', async ({ page }) => {
    test.setTimeout(120_000);

    // Landscape phone: the chrome leaves less room than the container's minimum
    // height, so the container keeps that minimum, the document grows past the
    // viewport and the page can be scrolled.
    await page.setViewportSize({ width: 844, height: 390 });
    await loadTestAccountAndOpenTransactions(page);
    expect((await measureTransactionsTable(page)).documentScrollable).toBe(true);

    // Scroll down, then grow the viewport — which is what a phone delivers when
    // its URL bar auto-hides mid-scroll, and the two together are what makes
    // measuring in viewport coordinates wrong. The scrolled-up top makes the
    // space below the table look larger than it is, so the container is handed
    // a height that pushes the document down further, and the next scroll makes
    // it larger again.
    await page.mouse.move(400, 200);
    await page.mouse.wheel(0, 200);
    // The wheel is handled on the compositor, so the scroll lands a frame or
    // two after the call returns — resizing before it does would measure an
    // unscrolled page and prove nothing.
    await page.waitForFunction('window.scrollY > 0');
    await page.setViewportSize({ width: 844, height: 440 });

    // Settle on the browser rather than on the height, which is what is under
    // test here: wait for the new viewport to be observable, then let two frames
    // pass so the resize handler and the observer have both run. Measuring any
    // earlier reads the height from before the resize, and the CSS floor keeps
    // the rendered height at 240px either way, so nothing would give it away.
    await page.waitForFunction('window.innerHeight === 440');
    await page.evaluate(() => new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const table = await readTransactionsTable(page);
    expect(table.scrollY).toBeGreaterThan(0);
    expect(table.inlineHeight).toBeCloseTo(expectedTableHeight(table), 0);
    expectTableReachable(table);
});

test('a viewport shorter than the page chrome still leaves the table reachable', async ({ page }) => {
    test.setTimeout(120_000);

    await page.setViewportSize({ width: 390, height: 844 });
    await loadTestAccountAndOpenTransactions(page);

    // Less screen than the chrome above the table needs, so "screen bottom
    // minus table top" comes out negative. A negative height is an invalid CSS
    // value that the CSSOM drops without a word, leaving the previous — here,
    // portrait-sized — height in place. The realistic version of this is the
    // navbar mid-animation, which is several rows tall for a moment.
    await page.setViewportSize({ width: 390, height: 150 });

    const table = await measureTransactionsTable(page);
    expect(expectedTableHeight(table)).toBe(0);   // the case is set up as intended
    expect(table.inlineHeight).toBe(0);
    expectTableReachable(table);
});

test('the table does not reserve an empty screenful before an account is picked', async ({ page }) => {
    test.setTimeout(120_000);

    await page.setViewportSize({ width: 390, height: 844 });
    await setupApiMocks(page);
    await page.goto('/');
    await navigateTo(page, 'Transactions');

    const table = await measureTransactionsTable(page);

    // Nothing has been selected, so there is nothing to scroll: the container
    // collapses to its header row instead of leaving a screen-height blank box
    // under it.
    expect(table.rowCount).toBe(0);
    expect(table.visibleHeight).toBeLessThan(table.viewportHeight * 0.25);
    expect(table.documentScrollable).toBe(false);
});
