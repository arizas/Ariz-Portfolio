import { getCustomExchangeRatesAsTable, setCustomExchangeRatesFromTable, getHistoricalPriceData, setHistoricalPriceData, getAllFungibleTokenTransactions, fetchFungibleTokenTransactionsForAccount, getTransactionsForAccount, getAllFungibleTokenSymbols, setAccounts, writeConfidentialIntentsHistory, getConfidentialIntentsHistory, getRecordsForAccount, writeFungibleTokenTransactions } from './domainobjectstore.js';
import { historyItem } from '../near/intentshistory.mock.js';

// Serve the intents token-metadata API from a fixture so the confidential
// derivation (which resolves decimals/symbols through it) is hermetic.
before(() => {
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

describe('domainobjectstore', () => {
    it('should get and set custom exchange rates from table', async function () {
        const customexchangeratestable = [
            {
                date: '2022-04-14',
                currency: 'nok',
                price: 20.3,
                buysell: 'buy'
            },
            {
                date: '2022-06-12',
                currency: 'nok',
                price: 13.3,
                buysell: 'sell'
            }
        ];
        await setCustomExchangeRatesFromTable(customexchangeratestable);
        const restoredcustomexchangeratestable = await getCustomExchangeRatesAsTable();
        expect(restoredcustomexchangeratestable).to.deep.equal(customexchangeratestable);
    });
    it('should get and set pricedata', async () => {
        const pricedata = await getHistoricalPriceData('NEAR', 'USD');
        pricedata['2024-01-01'] = 13.3;
        await setHistoricalPriceData('NEAR', 'USD', pricedata);
        expect(await getHistoricalPriceData('NEAR', 'USD')).to.deep.equal(pricedata);
    });
    it('should store wNEAR pricedata under NEAR so writes are visible on read', async () => {
        // wNEAR tracks NEAR 1:1 and shares NEAR's price file. Writing under wNEAR
        // must be readable back under wNEAR (and under NEAR) - otherwise the
        // year-report re-prompts "price missing locally" for every date.
        await setHistoricalPriceData('wNEAR', 'NOK', { '2026-05-27': 23.64 });
        expect(await getHistoricalPriceData('wNEAR', 'NOK')).to.deep.equal({ '2026-05-27': 23.64 });
        expect(await getHistoricalPriceData('NEAR', 'NOK')).to.deep.equal({ '2026-05-27': 23.64 });
    });
    it('should get all fungible token transactions', async () => {
        const accountId = 'petersalomonsen.near';
        let transactions = await getAllFungibleTokenTransactions(accountId);
        expect(transactions.length).to.equal(0);
        transactions = await fetchFungibleTokenTransactionsForAccount(accountId);
        expect(transactions.length).to.equal(176);
        transactions = await getAllFungibleTokenTransactions(accountId);
        expect(transactions.length).to.equal(176);
        transactions = await getTransactionsForAccount(accountId, 'USDC');
        expect(transactions.length).to.equal(16);
        expect(transactions.reduce((p, c) => BigInt(c.delta_amount) + p, 0n)).to.equal(4563n);
    });
    it('should get all fungible token symbols', async () => {
        const accountId = 'petersalomonsen.near';
        await setAccounts([accountId]);
        await fetchFungibleTokenTransactionsForAccount(accountId)
        expect(await getAllFungibleTokenSymbols()).to.include("wNEAR");
        expect(await getAllFungibleTokenSymbols()).to.include("USDC");
        expect(await getAllFungibleTokenSymbols()).to.include("USDt");
    });
});

describe('domainobjectstore confidential intents history', () => {
    const account = 'confidential-test.near';

    const shielding = historyItem({
        createdAt: '2026-07-08T18:04:42.251349Z',
        depositType: 'INTENTS', recipientType: 'CONFIDENTIAL_INTENTS',
        originAsset: 'nep141:btc.omft.near', destinationAsset: 'nep141:btc.omft.near',
        amountInFormatted: '0.00544253', amountOutFormatted: '0.00544253',
        depositAddress: 'shield1',
    });
    const confidentialSwap = historyItem({
        createdAt: '2026-07-08T18:06:38.646840Z',
        depositType: 'CONFIDENTIAL_INTENTS', recipientType: 'CONFIDENTIAL_INTENTS',
        originAsset: 'nep141:btc.omft.near', destinationAsset: 'nep141:wrap.near',
        amountInFormatted: '0.00544253', amountOutFormatted: '178.7',
        depositAddress: 'swap1',
    });

    before(async () => {
        await writeConfidentialIntentsHistory(account, [confidentialSwap, shielding]);
    });

    it('round-trips the history file (sorted oldest-first)', async () => {
        const stored = await getConfidentialIntentsHistory(account);
        expect(stored.length).to.equal(2);
        expect(stored[0].depositAddress).to.equal('shield1');
        expect(stored[1].depositAddress).to.equal('swap1');
    });

    it('getRecordsForAccount includes the derived confidential rows without a records.json', async () => {
        const records = await getRecordsForAccount(account);
        expect(records.map((r) => `${r.token_id} ${r.amount}`)).to.deep.equal([
            'confidential:nep141:btc.omft.near 544253',
            'confidential:nep141:btc.omft.near -544253',
            'confidential:nep141:wrap.near 178700000000000000000000000',
        ]);
    });

    it('getAllFungibleTokenTransactions merges derived confidential rows, filterable as their own bucket', async () => {
        const all = await getAllFungibleTokenTransactions(account);
        expect(all.length).to.equal(3);

        const bucket = await getTransactionsForAccount(account, 'confidential:nep141:btc.omft.near');
        expect(bucket.length).to.equal(2);
        expect(bucket[0].delta_amount).to.equal('-544253'); // newest-first: swap out, then shield in
        expect(bucket[1].delta_amount).to.equal('544253');
        expect(bucket[0].ft.symbol).to.equal('BTC');
        expect(bucket[0].ft.decimals).to.equal(8);
        expect(bucket[0].balance).to.equal('0');
        expect(bucket[1].balance).to.equal('544253');
    });

    it('writeFungibleTokenTransactions never persists derived confidential rows', async () => {
        // Simulate a read-modify-write cycle (what every sync/merge path does).
        const all = await getAllFungibleTokenTransactions(account);
        await writeFungibleTokenTransactions(account, all);
        // Still 3 — the derived rows were stripped on write, so the read-time
        // merge doesn't duplicate them.
        expect((await getAllFungibleTokenTransactions(account)).length).to.equal(3);
    });
});