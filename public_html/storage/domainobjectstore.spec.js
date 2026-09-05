import { getCustomExchangeRatesAsTable, setCustomExchangeRatesFromTable, getHistoricalPriceData, setHistoricalPriceData, getAllFungibleTokenTransactions, fetchFungibleTokenTransactionsForAccount, getTransactionsForAccount, getAllFungibleTokenSymbols, setAccounts, writeConfidentialIntentsHistory, getConfidentialIntentsHistory, getRecordsForAccount, writeFungibleTokenTransactions,
    reconcileStoredConfidentialBalances } from './domainobjectstore.js';
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

describe('domainobjectstore confidential history merging', () => {
    // A fresh account per test: the write merges by design, so there is no
    // "clear" to reset with.
    let account;
    let accountCounter = 0;

    // Two shieldings and the swap that spends the first of them.
    const older = historyItem({
        createdAt: '2026-03-19T20:30:12.420749Z',
        depositType: 'INTENTS', recipientType: 'CONFIDENTIAL_INTENTS',
        originAsset: 'nep141:btc.omft.near', destinationAsset: 'nep141:btc.omft.near',
        amountInFormatted: '0.00544253', amountOutFormatted: '0.00544253',
        depositAddress: 'older1',
    });
    const newer = historyItem({
        createdAt: '2026-09-03T18:04:13.939856Z',
        depositType: 'INTENTS', recipientType: 'CONFIDENTIAL_INTENTS',
        originAsset: 'nep141:btc.omft.near', destinationAsset: 'nep141:btc.omft.near',
        amountInFormatted: '0.00161000', amountOutFormatted: '0.00161000',
        depositAddress: 'newer1',
    });

    beforeEach(() => {
        account = `confidential-merge-${accountCounter++}.near`;
    });

    it('keeps history the fetch no longer returns', async () => {
        // REGRESSION (2026-09). The host silently started returning only its
        // newest page; the wholesale overwrite this replaced turned that into
        // the deletion of 13 items of real history, and a confidential balance
        // that was wrong while still adding up.
        await writeConfidentialIntentsHistory(account, [older, newer]);

        const result = await writeConfidentialIntentsHistory(account, [newer]);

        expect(result).to.deep.equal({ total: 2, added: 0, updated: 0 });
        const stored = await getConfidentialIntentsHistory(account);
        expect(stored.map((i) => i.depositAddress)).to.deep.equal(['older1', 'newer1']);
    });

    it('reports what a fetch actually contributed', async () => {
        expect(await writeConfidentialIntentsHistory(account, [older]))
            .to.deep.equal({ total: 1, added: 1, updated: 0 });
        expect(await writeConfidentialIntentsHistory(account, [older, newer]))
            .to.deep.equal({ total: 2, added: 1, updated: 0 });
    });

    it('lets a fresher copy of an item win, so PENDING settles into SUCCESS', async () => {
        const pending = { ...newer, status: 'PENDING_DEPOSIT' };
        await writeConfidentialIntentsHistory(account, [older, pending]);
        // Only the shielded 0.00544253 counts while the second is pending.
        expect((await getRecordsForAccount(account)).length).to.equal(1);

        const result = await writeConfidentialIntentsHistory(account, [newer]);

        expect(result).to.deep.equal({ total: 2, added: 0, updated: 1 });
        const stored = await getConfidentialIntentsHistory(account);
        expect(stored.find((i) => i.depositAddress === 'newer1').status).to.equal('SUCCESS');
        expect((await getRecordsForAccount(account)).length).to.equal(2);
    });

    it('reconciles the stored history against the ledger the API reports', async () => {
        await writeConfidentialIntentsHistory(account, [older, newer]);
        const btc = 'nep141:btc.omft.near';

        // 0.00544253 + 0.00161 BTC = 705253 raw units.
        expect(await reconcileStoredConfidentialBalances(account, new Map([[btc, 705253n]])))
            .to.deep.equal([]);

        // What a store missing its oldest item looks like from the outside.
        const [mismatch] = await reconcileStoredConfidentialBalances(account, new Map([[btc, 999999n]]));
        expect(mismatch.assetId).to.equal(btc);
        expect(mismatch.derived).to.equal(705253n);
        expect(mismatch.actual).to.equal(999999n);
        expect(mismatch.symbol).to.equal('BTC');
        expect(mismatch.decimals).to.equal(8);
    });

    it('flags an asset the API holds that the stored history never saw', async () => {
        await writeConfidentialIntentsHistory(account, [older, newer]);

        const mismatches = await reconcileStoredConfidentialBalances(
            account, new Map([['nep141:btc.omft.near', 705253n], ['nep141:wrap.near', 5n]]));

        expect(mismatches.map((m) => m.assetId)).to.deep.equal(['nep141:wrap.near']);
        expect(mismatches[0].derived).to.equal(0n);
    });
});
