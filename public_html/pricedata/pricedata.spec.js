import { getEODPrice, fetchHistoricalPricesFromArizGateway, __resetNoPriceTokens } from "./pricedata.js";
import { mockWalletAuthenticationData, mockArizGatewayAccess } from "../arizgateway/arizgatewayaccess.spec.js";

// Wait for the "Fetch price data?" modal to appear and click Yes/No.
async function answerModal(answer) {
    for (let i = 0; i < 300; i++) {
        const modalEl = document.querySelector('common-modal');
        if (modalEl) {
            const button = [...modalEl.shadowRoot.querySelectorAll('button')]
                .find(b => b.textContent.trim() === (answer ? 'Yes' : 'No'));
            button.click();
            return;
        }
        await new Promise(r => setTimeout(r, 10));
    }
    throw new Error('price-fetch modal did not appear');
}

describe('pricedata from Ariz gateway', () => {
    before(async function () {
        mockWalletAuthenticationData();
        await mockArizGatewayAccess();
    });
    it('should get NOK NEAR price data for day', async function () {
        await fetchHistoricalPricesFromArizGateway({currency: 'NOK', todate: '2024-05-30'});

        expect(await getEODPrice('NOK', '2021-02-23')).to.be.closeTo(32.04, 0.1);
        expect(await getEODPrice('NOK', '2022-01-16')).to.be.closeTo(169.67, 0.7);
        expect(await getEODPrice('NOK', '2023-12-25')).to.be.closeTo(38.79, 0.2);
        expect(await getEODPrice('NOK', '2023-12-27')).to.be.closeTo(43.64, 0.1);
        expect(await getEODPrice('NOK', '2024-02-29')).to.be.closeTo(41.2, 0.1);
        expect(await getEODPrice('NOK', '2024-03-01')).to.be.closeTo(41.1, 0.2);
        expect(await getEODPrice('NOK', '2024-03-26')).to.be.closeTo(79.92, 0.05);
    });
    it('should get price data for day', async function () {
        await fetchHistoricalPricesFromArizGateway({currency: 'USD', todate: '2024-05-30'});
        expect(await getEODPrice('USD', '2024-01-01')).to.be.closeTo(3.65425834, 0.00001);
    });
    it('does not prompt for a token the gateway reports as having no price', async function () {
        // Gateway /api/prices/nopricetokens returns ["scamtoken"] (cached fixture).
        // The client must trust that and skip silently - no modal, returns 0.
        __resetNoPriceTokens();
        expect(await getEODPrice('NOK', '2024-01-01', 'SCAMTOKEN')).to.equal(0);
        expect(document.querySelector('common-modal')).to.equal(null);
    });
    it('prompts once for an unknown token, then stops re-prompting after an empty fetch', async function () {
        // Not in the gateway no-price set yet, so the user is asked. The fetch
        // returns an empty history (gateway has no price), and the next date must
        // not prompt again - one whole-history fetch is enough.
        __resetNoPriceTokens();
        const firstLookup = getEODPrice('NOK', '2024-01-01', 'NEWSCAM');
        await answerModal(true);
        expect(await firstLookup).to.equal(0);

        expect(await getEODPrice('NOK', '2024-01-02', 'NEWSCAM')).to.equal(0);
        expect(document.querySelector('common-modal')).to.equal(null);
    });
});
