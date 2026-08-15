import { test, expect } from '@playwright/test';
import {
    loadTestAccountAndOpenTransactions,
    measureTransactionsTable,
    expectTableReachable,
} from '../util/transactions-testflow.js';

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

        // Room for the header plus a screenful of rows, not just two.
        const visibleRows = (table.visibleHeight - table.headerHeight) / table.rowHeight;
        expect(visibleRows).toBeGreaterThanOrEqual(6);

        await expectTableReachable(page, table);
    });
}

test('expanding the description resizes the table, collapsing it restores the height', async ({ page }) => {
    test.setTimeout(120_000);

    await page.setViewportSize({ width: 390, height: 844 });
    await loadTestAccountAndOpenTransactions(page);

    const collapsed = await measureTransactionsTable(page);

    // Reading the description is still possible on a phone, and the table
    // resizes around it instead of keeping a stale height.
    const description = page.locator('transactions-page').locator('#pagedescription');
    await description.locator('summary').click();
    await expect(description).toHaveJSProperty('open', true);

    const expanded = await measureTransactionsTable(page);
    expect(expanded.top).toBeGreaterThan(collapsed.top);
    await expectTableReachable(page, expanded);

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

    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(200);
    const landscape = await measureTransactionsTable(page);

    // The height used to be computed once at render time, so after a rotation
    // the table kept its portrait height and hung far below the screen.
    expect(landscape.visibleHeight).toBeLessThan(portrait.visibleHeight);
    await expectTableReachable(page, landscape);
});
