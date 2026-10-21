// A token's symbol is whatever its minter wrote, and anyone can send one to any
// account. Wherever a name like this reached innerHTML unescaped, opening the
// page ran the minter's script inside the app — with the whole store and the
// gateway session in reach. Each view below gets the same name and must show it
// as text.
import '../counterparties/counterparties-page.component.js';
import './../yearreport/yearreport-print.component.js';
import { renderPeriodReportTable } from '../yearreport/yearreport-table-renderer.js';
import { modalAlert } from '../ui/modal.js';
import { setProgressbarValue } from '../ui/progress-bar.js';
import { setSkipFetchingPrices } from '../pricedata/pricedata.js';
import { setAccounts } from '../storage/domainobjectstore.js';
import { mockArizGatewayAccess, mockWalletAuthenticationData } from '../arizgateway/arizgatewayaccess.spec.js';

// Markup that does nothing when parsed: an <img onerror> would prove the same
// thing but also fetch, and a page that injects it hangs the test run.
const PAYLOAD = '<b class="injected">MOON</b>"\'';

function expectInert(root) {
    // A boolean, not the element: a failure carrying a DOM node takes the
    // test runner's connection down instead of reporting.
    expect(!!root.querySelector('.injected'), 'markup from the name was parsed').to.equal(false);
    expect(root.textContent).to.include(PAYLOAD);
}

describe('a token name is shown as text, never run', () => {
    before(async () => { await setAccounts([]); });

    it('in the counterparties table, as an account and as a symbol', async () => {
        const el = document.createElement('counterparties-page');
        await el.readyPromise;
        el.counterparties = {
            [PAYLOAD]: {
                account: PAYLOAD, txCount: 1, description: PAYLOAD,
                tokens: { [PAYLOAD]: { decimals: 0, incoming: 5n, outgoing: 0n } },
                incomingUsd: 0, outgoingUsd: 0,
            },
        };
        el.renderTable();
        const body = el.shadowRoot.getElementById('counterpartyTableBody');
        expect(!!body.querySelector('.injected'), 'markup from the name was parsed').to.equal(false);
        expect(body.textContent).to.include(PAYLOAD);
        // Attributes round-trip to the original name, not to its escaped form.
        expect(body.querySelector('.classification-select').dataset.account).to.equal(PAYLOAD);
        expect(body.querySelector('.description-input').value).to.equal(PAYLOAD);
    });

    // The print page takes the token from its URL and, for one it does not know,
    // shows the URL's text as the symbol beside every amount.
    it('beside every amount in a single token\'s table', async function () {
        mockWalletAuthenticationData();
        await mockArizGatewayAccess();
        setSkipFetchingPrices(PAYLOAD, 'usd');
        const print = document.createElement('year-report-print');
        const shadowRoot = print.getRootNode().shadowRoot;
        await renderPeriodReportTable({
            shadowRoot, token: PAYLOAD, convertToCurrency: 'usd',
            periodStartDate: new Date('2024-01-01'), periodEndDate: new Date('2024-01-03'),
            perRowFunction: async () => { },
        });
        expectInert(shadowRoot.querySelector('#dailybalancestable'));
    });

    it('in an error message', async () => {
        const shown = modalAlert(PAYLOAD, `Could not fetch ${PAYLOAD}`);
        const modal = document.querySelector('common-modal');
        expectInert(modal.shadowRoot);
        modal.shadowRoot.result(true);
        await shown;
    });

    it('on the progress bar', () => {
        setProgressbarValue('indeterminate', PAYLOAD);
        expectInert(document.querySelector('progress-bar').shadowRoot);
        setProgressbarValue(0.5, PAYLOAD);
        expectInert(document.querySelector('progress-bar').shadowRoot);
        setProgressbarValue(null);
    });
});
