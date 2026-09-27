import { calculateYearReportData, calculateProfitLoss } from './yearreportdata.js';
import { setAccounts, writeConfidentialIntentsHistory, writeTransactions, writeFungibleTokenTransactions, setHistoricalPriceData } from '../storage/domainobjectstore.js';
import { setSkipFetchingPrices, clearPriceHistoryCache } from '../pricedata/pricedata.js';
import { historyItem } from '../near/intentshistory.mock.js';
import { indexSwapLegs, resolveSwapValue } from './swap-legs.js';

// A swap's two sides share one figure. What the source token was sold for is
// what the destination token cost — otherwise the difference between the two
// tokens' closing prices leaks out of the books for good. Which figure: a
// stablecoin leg if there is one, else the destination at its close, else the
// source at its close. These specs run the real engine over a confidential
// ledger and over on-chain records, priced from fixtures.

const BTC = 'nep141:btc.omft.near';
const WNEAR = 'nep141:wrap.near';
const USDC = 'nep141:usdc.fake.near';

before(() => {
    const realFetch = window.fetch;
    window.fetch = async (url, init) => {
        if (String(url) === 'https://1click.chaindefuser.com/v0/tokens') {
            return new Response(JSON.stringify([
                { assetId: BTC, symbol: 'BTC', decimals: 8, blockchain: 'btc' },
                { assetId: WNEAR, symbol: 'wNEAR', decimals: 24, blockchain: 'near' },
                { assetId: USDC, symbol: 'USDC', decimals: 6, blockchain: 'near' },
                { assetId: 'nep141:btc.fake.near', symbol: 'BTC', decimals: 8, blockchain: 'near' },
            ]), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return realFetch(url, init);
    };
});

async function seedPrices() {
    await setHistoricalPriceData('BTC', 'USD', {
        '2024-03-01': 50000, '2024-03-02': 60000, '2024-03-07': 70000,
    });
    await setHistoricalPriceData('NEAR', 'USD', {
        '2024-03-02': 2.8, '2024-03-03': 3.0, '2024-03-04': 3.5,
        '2024-03-05': 3.0, '2024-03-06': 3.2, '2024-03-07': 3.3,
    });
    for (const token of ['BTC', 'NEAR', 'wNEAR', 'USDC']) setSkipFetchingPrices(token, 'USD');
    clearPriceHistoryCache();
}

const ns = iso => (BigInt(new Date(iso).getTime()) * 1_000_000n).toString();

describe('swap-legs', () => {
    it('finds every token a key moved, and only keys that moved more than one', () => {
        const swaps = indexSwapLegs({
            nativeByAccount: {
                'a.near': [
                    { hash: 'SWAP', balance: '9000000000000000000000000', block_timestamp: '2' },
                    { hash: 'FUND', balance: '10000000000000000000000000', block_timestamp: '1' },
                ],
            },
            fungibleByAccount: {
                'a.near': [
                    { transaction_hash: 'SWAP', balance: '3000000', ft: { contract_id: 'usdc.near', symbol: 'USDC', decimals: 6 } },
                    { transaction_hash: 'OTHER', balance: '5', ft: { contract_id: 'x.near', symbol: 'X', decimals: 0 } },
                ],
            },
        });
        expect([...swaps.keys()]).to.deep.equal(['SWAP']);
        const legs = swaps.get('SWAP').map(l => [l.token, l.changed]);
        expect(legs).to.deep.equal([['', -1000000000000000000000000n], ['usdc.near', 3000000n]]);
    });

    it('groups the two synthetic halves of a confidential swap', () => {
        const swaps = indexSwapLegs({
            fungibleByAccount: {
                'a.near': [
                    { transaction_hash: 'confidential:addr:in', balance: '25', ft: { contract_id: 'confidential:b', symbol: 'B', decimals: 0 } },
                    { transaction_hash: 'confidential:addr:out', balance: '0', ft: { contract_id: 'confidential:a', symbol: 'A', decimals: 0 } },
                    { transaction_hash: 'confidential:earlier:in', balance: '2', ft: { contract_id: 'confidential:a', symbol: 'A', decimals: 0 } },
                ],
            },
        });
        expect([...swaps.keys()]).to.deep.equal(['confidential:addr']);
    });

    it('trusts a stablecoin leg over either close, the destination over the source', () => {
        const near = { token: '', symbol: 'NEAR', decimals: 24, changed: -10n };
        const usdc = { token: 'u', symbol: 'USDC', decimals: 6, changed: 28n };
        const btc = { token: 'b', symbol: 'BTC', decimals: 8, changed: 1n };
        const value = ({ symbol }) => ({ NEAR: -32, USDC: 28, BTC: 30 })[symbol];

        expect(resolveSwapValue([near, usdc], value)).to.include({ value: 28, valuedBy: 'stablecoin' });
        expect(resolveSwapValue([near, btc], value)).to.include({ value: 30, valuedBy: 'destination' });
        expect(resolveSwapValue([near, btc], l => l.symbol === 'BTC' ? null : value(l))).to.include({ value: 32, valuedBy: 'source' });
        expect(resolveSwapValue([near, btc], () => null)).to.equal(null);
    });

    it('sets gas aside: a speck of NEAR beside a trade is not a side of it', () => {
        const gas = { token: '', symbol: 'NEAR', decimals: 24, changed: -1n };
        const usdc = { token: 'u', symbol: 'USDC', decimals: 6, changed: -28n };
        const btc = { token: 'b', symbol: 'BTC', decimals: 8, changed: 1n };
        const resolved = resolveSwapValue([gas, usdc, btc], ({ symbol }) => ({ NEAR: -0.002, USDC: -28, BTC: 29 })[symbol]);
        expect(resolved.legs.map(l => l.symbol)).to.deep.equal(['USDC', 'BTC']);
        expect(resolved).to.include({ value: 28, valuedBy: 'stablecoin' });
        // Gas alone beside a plain transfer is no swap at all.
        expect(resolveSwapValue([gas, usdc], ({ symbol }) => ({ NEAR: -0.002, USDC: -28 })[symbol])).to.equal(null);
    });
});

describe('year report: both sides of a swap on one figure', () => {
    describe('confidential ledger', () => {
        const account = 'swap-year.near';

        before(async function () {
            this.timeout(60000);
            await seedPrices();
            await setAccounts([account]);
            await writeConfidentialIntentsHistory(account, [
                historyItem({
                    createdAt: '2024-03-01T10:00:00.000000Z',
                    depositType: 'INTENTS', recipientType: 'CONFIDENTIAL_INTENTS',
                    originAsset: BTC, destinationAsset: BTC,
                    amountInFormatted: '0.01', amountOutFormatted: '0.01',
                    depositAddress: 'shield',
                }),
                // 0.005 BTC -> 100 wNEAR. BTC closes at 60000 (300 out), NEAR at 2.8 (280 in).
                historyItem({
                    createdAt: '2024-03-02T10:00:00.000000Z',
                    depositType: 'CONFIDENTIAL_INTENTS', recipientType: 'CONFIDENTIAL_INTENTS',
                    originAsset: BTC, destinationAsset: WNEAR,
                    amountInFormatted: '0.005', amountOutFormatted: '100',
                    depositAddress: 'swap1',
                }),
                // 50 wNEAR -> 140 USDC. NEAR closes at 3.0 (150 out); the stablecoin says 140.
                historyItem({
                    createdAt: '2024-03-03T10:00:00.000000Z',
                    depositType: 'CONFIDENTIAL_INTENTS', recipientType: 'CONFIDENTIAL_INTENTS',
                    originAsset: WNEAR, destinationAsset: USDC,
                    amountInFormatted: '50', amountOutFormatted: '140',
                    depositAddress: 'swap2',
                }),
                // 100 USDC -> 30 wNEAR. NEAR closes at 3.5 (105 in); the stablecoin says 100.
                historyItem({
                    createdAt: '2024-03-04T10:00:00.000000Z',
                    depositType: 'CONFIDENTIAL_INTENTS', recipientType: 'CONFIDENTIAL_INTENTS',
                    originAsset: USDC, destinationAsset: WNEAR,
                    amountInFormatted: '100', amountOutFormatted: '30',
                    depositAddress: 'swap3',
                }),
            ]);
        });

        const report = async token => calculateProfitLoss((await calculateYearReportData(token)).dailyBalances, 'USD', token);

        it('sells the source for what the destination closed at, not what the source did', async function () {
            this.timeout(60000);
            const { dailyBalances } = await report(`confidential:${BTC}`);
            const day = dailyBalances['2024-03-02'];
            // Proceeds 280 against a basis of 0.005 x 50000 = 250. At the BTC
            // close it would have been 300, and the 20 would never come back.
            expect(day.profit).to.be.closeTo(30, 1e-6);
            expect(day.loss).to.equal(0);
            expect(day.realizations).to.have.length(1);
            expect(day.realizations[0].conversionRate).to.be.closeTo(56000, 1e-6);
            expect(day.realizations[0].swap).to.include({ valuedBy: 'destination' });
            expect(day.realizations[0].swap.authority).to.deep.equal(['wNEAR']);
        });

        it('opens the destination at the same figure', async function () {
            this.timeout(60000);
            const { openPositions } = await report(`confidential:${WNEAR}`);
            const lot = openPositions.find(p => p.date === '2024-03-02');
            expect(lot.convertedValue).to.be.closeTo(280, 1e-6);
            expect(lot.swap).to.include({ valuedBy: 'destination' });
        });

        it('lets a stablecoin destination say what the source fetched', async function () {
            this.timeout(60000);
            const { dailyBalances } = await report(`confidential:${WNEAR}`);
            const day = dailyBalances['2024-03-03'];
            // 50 of the 100 wNEAR that cost 280: basis 140, sold for 140 USDC.
            expect(day.profit).to.be.closeTo(0, 1e-6);
            expect(day.loss).to.be.closeTo(0, 1e-6);
            expect(day.realizations[0].swap).to.include({ valuedBy: 'stablecoin' });
            expect(day.realizations[0].swap.authority).to.deep.equal(['USDC']);
        });

        it('lets a stablecoin source say what the destination cost, and shows no gain on the stablecoin', async function () {
            this.timeout(60000);
            const usdc = await report(`confidential:${USDC}`);
            const day = usdc.dailyBalances['2024-03-04'];
            expect(day.profit).to.be.closeTo(0, 1e-6);
            expect(day.loss).to.be.closeTo(0, 1e-6);
            expect(day.realizations[0].swap).to.include({ valuedBy: 'stablecoin' });

            const wnear = await report(`confidential:${WNEAR}`);
            const lot = wnear.openPositions.find(p => p.date === '2024-03-04');
            // 100, not the 105 the NEAR close would have said.
            expect(lot.convertedValue).to.be.closeTo(100, 1e-6);
            expect(lot.swap).to.include({ valuedBy: 'stablecoin' });
        });
    });

    describe('on chain', () => {
        const account = 'swapper.near';

        before(async function () {
            this.timeout(60000);
            await seedPrices();
            await setAccounts([account]);
            // Newest first, as stored.
            await writeTransactions(account, [
                // Gas only: a USDC -> BTC trade that touched NEAR for its fee.
                { hash: 'FT2FT', block_timestamp: ns('2024-03-07T10:00:00Z'), signer_id: account, receiver_id: 'ref.near', action_kind: 'FUNCTION_CALL', args: {}, balance: '9998500000000000000000000' },
                // 10.001 NEAR out for 28 USDC.
                { hash: 'SWAPH', block_timestamp: ns('2024-03-06T10:00:00Z'), signer_id: account, receiver_id: 'ref.near', action_kind: 'FUNCTION_CALL', args: {}, balance: '9999000000000000000000000' },
                // 20 NEAR in from outside.
                { hash: 'FUND', block_timestamp: ns('2024-03-05T10:00:00Z'), signer_id: 'someone.near', receiver_id: account, action_kind: 'TRANSFER', args: {}, balance: '20000000000000000000000000' },
            ]);
            await writeFungibleTokenTransactions(account, [
                { transaction_hash: 'FT2FT', block_timestamp: ns('2024-03-07T10:00:00Z'), affected_account_id: account, involved_account_id: 'ref.near', balance: '40000', ft: { contract_id: 'btc.fake.near', symbol: 'BTC', decimals: 8 } },
                { transaction_hash: 'FT2FT', block_timestamp: ns('2024-03-07T10:00:00Z'), affected_account_id: account, involved_account_id: 'ref.near', balance: '0', ft: { contract_id: 'usdc.fake.near', symbol: 'USDC', decimals: 6 } },
                { transaction_hash: 'SWAPH', block_timestamp: ns('2024-03-06T10:00:00Z'), affected_account_id: account, involved_account_id: 'ref.near', balance: '28000000', ft: { contract_id: 'usdc.fake.near', symbol: 'USDC', decimals: 6 } },
            ]);
        });

        const report = async token => calculateProfitLoss((await calculateYearReportData(token)).dailyBalances, 'USD', token);

        it('books the spread as a loss on the NEAR sold for USDC', async function () {
            this.timeout(60000);
            const { dailyBalances } = await report();
            const day = dailyBalances['2024-03-06'];
            // 10.001 NEAR that cost 3.0 each (30.003), sold for 28 USDC.
            expect(day.loss).to.be.closeTo(2.003, 1e-6);
            expect(day.profit).to.equal(0);
            expect(day.realizations[0].swap).to.include({ valuedBy: 'stablecoin' });
        });

        it('does not mistake the gas of a token trade for a side of it', async function () {
            this.timeout(60000);
            const { dailyBalances } = await report();
            const day = dailyBalances['2024-03-07'];
            expect(Number(day.withdrawal)).to.equal(500000000000000000000);
            expect(day.realizations[0].swap).to.equal(undefined);
            expect(day.realizations[0].conversionRate).to.equal(3.3);
        });

        it('carries the stablecoin figure through a token-to-token trade', async function () {
            this.timeout(60000);
            const usdc = await report('usdc.fake.near');
            const sold = usdc.dailyBalances['2024-03-07'];
            // The lot opened at 28 on the 6th and was sold whole on the 7th.
            expect(sold.realizations[0].initialConvertedValue).to.be.closeTo(28, 1e-6);
            expect(sold.realizations[0].position.swap).to.include({ valuedBy: 'stablecoin' });
            expect(sold.profit).to.be.closeTo(0, 1e-6);
            expect(sold.loss).to.be.closeTo(0, 1e-6);

            const btc = await report('btc.fake.near');
            const lot = btc.openPositions.find(p => p.date === '2024-03-07');
            expect(lot.convertedValue).to.be.closeTo(28, 1e-6);
            expect(lot.swap).to.include({ valuedBy: 'stablecoin' });
        });
    });
});
