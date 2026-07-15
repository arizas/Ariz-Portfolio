import { calculateYearReportData } from './yearreportdata.js';
import { setAccounts, writeConfidentialIntentsHistory } from '../storage/domainobjectstore.js';
import { historyItem } from '../near/intentshistory.mock.js';

// The confidential (TEE-ledger) holdings form their own year-report bucket —
// keyed by the confidential: contract id — so the EXISTING per-bucket engine
// realizes profit/loss on every shield/unshield/confidential swap without any
// special-case code (docs/tax-classification-intents.md). These specs prove
// the engine sees the derived rows as a normal token bucket.

before(() => {
    // Serve the intents token-metadata API from a fixture so decimals/symbol
    // resolution is hermetic.
    const realFetch = window.fetch;
    window.fetch = async (url, init) => {
        if (String(url) === 'https://1click.chaindefuser.com/v0/tokens') {
            return new Response(JSON.stringify([
                { assetId: 'nep141:btc.omft.near', symbol: 'BTC', decimals: 8, blockchain: 'btc' },
                { assetId: 'nep141:wrap.near', symbol: 'wNEAR', decimals: 24, blockchain: 'near' },
            ]), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return realFetch(url, init);
    };
});

describe('year report confidential intents bucket', () => {
    const account = 'confidential-year.near';

    before(async () => {
        await setAccounts([account]);
        await writeConfidentialIntentsHistory(account, [
            // Shield 0.005 BTC into the confidential ledger.
            historyItem({
                createdAt: '2024-03-01T10:00:00.000000Z',
                depositType: 'INTENTS', recipientType: 'CONFIDENTIAL_INTENTS',
                originAsset: 'nep141:btc.omft.near', destinationAsset: 'nep141:btc.omft.near',
                amountInFormatted: '0.005', amountOutFormatted: '0.005',
                depositAddress: 'year-shield',
            }),
            // Confidential swap: 0.002 BTC -> wNEAR (inside the ledger).
            historyItem({
                createdAt: '2024-03-10T10:00:00.000000Z',
                depositType: 'CONFIDENTIAL_INTENTS', recipientType: 'CONFIDENTIAL_INTENTS',
                originAsset: 'nep141:btc.omft.near', destinationAsset: 'nep141:wrap.near',
                amountInFormatted: '0.002', amountOutFormatted: '25',
                depositAddress: 'year-swap',
            }),
            // Unshield the remaining 0.003 BTC back to the public bucket.
            historyItem({
                createdAt: '2024-04-01T10:00:00.000000Z',
                depositType: 'CONFIDENTIAL_INTENTS', recipientType: 'INTENTS',
                originAsset: 'nep141:btc.omft.near', destinationAsset: 'nep141:btc.omft.near',
                amountInFormatted: '0.003', amountOutFormatted: '0.003',
                depositAddress: 'year-unshield',
            }),
        ]);
    });

    it('builds the confidential BTC balance series (shield in, swap out, unshield out)', async function () {
        this.timeout(60000);
        const dailydata = (await calculateYearReportData('confidential:nep141:btc.omft.near')).dailyBalances;
        expect(dailydata['2024-03-05'].accountBalance).to.equal(500000n);   // after shield
        expect(dailydata['2024-03-15'].accountBalance).to.equal(300000n);   // after confidential swap
        expect(dailydata['2024-04-02'].accountBalance).to.equal(0n);        // after unshield
        // The unshield leaves the bucket as a withdrawal — that's what the
        // engine realizes against the bucket's FIFO positions.
        expect(Number(dailydata['2024-04-01'].withdrawal)).to.equal(300000);
        expect(Number(dailydata['2024-03-10'].withdrawal)).to.equal(200000);
        expect(Number(dailydata['2024-03-01'].deposit)).to.equal(500000);
    });

    it('tracks the swap proceeds as the confidential wNEAR bucket', async function () {
        this.timeout(60000);
        const dailydata = (await calculateYearReportData('confidential:nep141:wrap.near')).dailyBalances;
        expect(dailydata['2024-03-15'].accountBalance).to.equal(25000000000000000000000000n);
        expect(Number(dailydata['2024-03-10'].deposit)).to.equal(25e24);
    });
});
