import {
    formattedAmountToRaw,
    confidentialMovementsForItem,
    deriveConfidentialRecords,
    deriveConfidentialFtTransactions,
    isDerivedConfidentialFtTransaction,
    confidentialBalancesFromItems,
    reconcileConfidentialBalances,
} from './confidentialledger.js';
import { historyItem } from './intentshistory.mock.js';

describe('confidentialledger (derivation of the confidential bucket)', () => {
    const metadataByAsset = new Map([
        ['nep141:btc.omft.near', { decimals: 8, symbol: 'BTC' }],
        ['nep141:wrap.near', { decimals: 24, symbol: 'wNEAR' }],
    ]);

    // The three real movement shapes (from captured 1Click responses):
    const shielding = historyItem({
        createdAt: '2026-07-08T18:04:42.251349Z',
        depositType: 'INTENTS', recipientType: 'CONFIDENTIAL_INTENTS',
        originAsset: 'nep141:btc.omft.near', destinationAsset: 'nep141:btc.omft.near',
        amountInFormatted: '0.00544253', amountOutFormatted: '0.00544253',
        depositAddress: 'shield1',
        quoteTransactions: [{ sender: 'alice.near', txHash: '5iPna7nUNHTSDxhJRKV6eJYozpCHA9h5EX871W5LGQen' }],
    });
    const confidentialSwap = historyItem({
        createdAt: '2026-07-08T18:06:38.646840Z',
        depositType: 'CONFIDENTIAL_INTENTS', recipientType: 'CONFIDENTIAL_INTENTS',
        originAsset: 'nep141:btc.omft.near', destinationAsset: 'nep141:wrap.near',
        amountInFormatted: '0.00544253', amountOutFormatted: '178.700953425886164961421727',
        depositAddress: 'swap1',
    });
    const unshielding = historyItem({
        createdAt: '2026-07-09T10:00:00.000000Z',
        depositType: 'CONFIDENTIAL_INTENTS', recipientType: 'INTENTS',
        originAsset: 'nep141:wrap.near', destinationAsset: 'nep141:wrap.near',
        amountInFormatted: '100', amountOutFormatted: '100',
        depositAddress: 'unshield1',
    });
    const failed = historyItem({
        createdAt: '2026-07-09T11:00:00.000000Z',
        status: 'FAILED',
        depositType: 'INTENTS', recipientType: 'CONFIDENTIAL_INTENTS',
        depositAddress: 'failed1',
    });

    it('formattedAmountToRaw converts exactly, without floats', () => {
        expect(formattedAmountToRaw('0.00544253', 8)).to.equal('544253');
        expect(formattedAmountToRaw('178.700953425886164961421727', 24)).to.equal('178700953425886164961421727');
        expect(formattedAmountToRaw('100', 24)).to.equal('100000000000000000000000000');
        expect(formattedAmountToRaw('0', 8)).to.equal('0');
    });

    it('maps shield/unshield/swap to their ledger movements; non-SUCCESS items to none', () => {
        expect(confidentialMovementsForItem(shielding).map((m) => `${m.direction}:${m.assetId}`))
            .to.deep.equal(['in:nep141:btc.omft.near']);
        expect(confidentialMovementsForItem(unshielding).map((m) => `${m.direction}:${m.assetId}`))
            .to.deep.equal(['out:nep141:wrap.near']);
        expect(confidentialMovementsForItem(confidentialSwap).map((m) => `${m.direction}:${m.assetId}`))
            .to.deep.equal(['out:nep141:btc.omft.near', 'in:nep141:wrap.near']);
        expect(confidentialMovementsForItem(failed)).to.deep.equal([]);
    });

    it('treats the 1cs_v1 spelling of an asset as the same bucket as the bare one', () => {
        // Real capture: a ZEC shielding arrives as "nep141:zec.omft.near", and a
        // later confidential swap returns the same asset as
        // "1cs_v1:near:nep141:zec.omft.near". Keyed literally these are two
        // buckets, so the shielded ZEC is never drawn down and the swap's ZEC
        // has no cost basis — silently wrong realized profit/loss.
        const zecMetadata = new Map([
            ['nep141:zec.omft.near', { decimals: 8, symbol: 'ZEC' }],
            ['nep141:usdc.omft.near', { decimals: 6, symbol: 'USDC' }],
        ]);
        const zecShieldIn = historyItem({
            createdAt: '2026-07-27T04:45:25.931239Z',
            depositType: 'INTENTS', recipientType: 'CONFIDENTIAL_INTENTS',
            originAsset: 'nep141:zec.omft.near', destinationAsset: 'nep141:zec.omft.near',
            amountInFormatted: '0.19866247', amountOutFormatted: '0.19866247',
            depositAddress: 'zecshield',
        });
        const swapIntoZec = historyItem({
            createdAt: '2026-08-09T20:28:01.661242Z',
            depositType: 'CONFIDENTIAL_INTENTS', recipientType: 'CONFIDENTIAL_INTENTS',
            originAsset: 'nep141:usdc.omft.near',
            destinationAsset: '1cs_v1:near:nep141:zec.omft.near',
            amountInFormatted: '37.313729', amountOutFormatted: '0.07201488',
            depositAddress: 'zecswap',
        });

        expect(confidentialMovementsForItem(swapIntoZec).map((m) => `${m.direction}:${m.assetId}`))
            .to.deep.equal(['out:nep141:usdc.omft.near', 'in:nep141:zec.omft.near']);

        // Both ZEC inflows accumulate in one bucket, so the balance carries over.
        const records = deriveConfidentialRecords([zecShieldIn, swapIntoZec], zecMetadata);
        const zec = records.filter((r) => r.token_id === 'confidential:nep141:zec.omft.near');
        expect(zec.length).to.equal(2);
        expect(zec.at(-1).balance_after).to.equal('27067735'); // 0.19866247 + 0.07201488 ZEC
    });

    it('derives records with running confidential balances, oldest-first', () => {
        // Deliberately unsorted input — derivation sorts by createdAt.
        const records = deriveConfidentialRecords([unshielding, confidentialSwap, shielding, failed], metadataByAsset);

        expect(records.map((r) => `${r.token_id} ${r.amount}`)).to.deep.equal([
            'confidential:nep141:btc.omft.near 544253',                              // shield in
            'confidential:nep141:btc.omft.near -544253',                             // swap out
            'confidential:nep141:wrap.near 178700953425886164961421727',             // swap in
            'confidential:nep141:wrap.near -100000000000000000000000000',            // unshield out
        ]);
        // BTC balance returns to zero after the swap; wNEAR carries the rest.
        expect(records[1].balance_after).to.equal('0');
        expect(records[3].balance_after).to.equal('78700953425886164961421727');
        expect(records[3].balance_before).to.equal('178700953425886164961421727');
        // Off-chain rows: no block height, ISO timestamp carries ordering.
        expect(records[0].block_height).to.equal(null);
        expect(records[0].block_timestamp).to.equal(shielding.createdAt);
        // The shielding keeps its real quote tx hash for provenance/explorer link.
        expect(records[0].tx_hash).to.equal('5iPna7nUNHTSDxhJRKV6eJYozpCHA9h5EX871W5LGQen');
        expect(records[2].tx_hash).to.equal(null);
    });

    it('derives fungible-token transactions newest-first with synthetic hashes and confidential bucket ids', () => {
        const ftTransactions = deriveConfidentialFtTransactions(
            [shielding, confidentialSwap, unshielding], 'alice.near', metadataByAsset);

        // Newest-first: unshield, swap-in, swap-out, shield.
        expect(ftTransactions.map((tx) => tx.delta_amount)).to.deep.equal([
            '-100000000000000000000000000',
            '178700953425886164961421727',
            '-544253',
            '544253',
        ]);
        // The engine walks balance[n] - balance[n+1] newest-first.
        expect(ftTransactions[3].balance).to.equal('544253');
        expect(ftTransactions[2].balance).to.equal('0');
        expect(ftTransactions[0].ft).to.deep.equal({
            contract_id: 'confidential:nep141:wrap.near', symbol: 'wNEAR', decimals: 24,
        });
        // Synthetic hashes always — a real quote txHash here would group the
        // confidential leg with the public-side leg in the year report.
        for (const tx of ftTransactions) {
            expect(tx.transaction_hash.startsWith('confidential:')).to.equal(true);
            expect(isDerivedConfidentialFtTransaction(tx)).to.equal(true);
        }
        expect(new Set(ftTransactions.map((tx) => tx.transaction_hash)).size).to.equal(4);
        // ns timestamps as the FT-transaction format expects.
        expect(ftTransactions[3].block_timestamp).to.equal(
            (BigInt(new Date(shielding.createdAt).getTime()) * 1_000_000n).toString());
    });

    it('throws on missing metadata instead of deriving with wrong decimals', () => {
        expect(() => deriveConfidentialRecords([shielding], new Map()))
            .to.throw('missing token metadata for nep141:btc.omft.near');
    });

    it('does not flag gateway-sourced fungible token transactions as derived', () => {
        expect(isDerivedConfidentialFtTransaction({
            _source: 'accounting-export',
            ft: { contract_id: 'nep141:btc.omft.near' },
        })).to.equal(false);
    });
});


describe('confidentialledger balance reconciliation', () => {
    const metadataByAsset = new Map([
        ['nep141:btc.omft.near', { decimals: 8, symbol: 'BTC' }],
        ['nep141:wrap.near', { decimals: 24, symbol: 'wNEAR' }],
    ]);

    const shielding = historyItem({
        createdAt: '2026-03-19T20:30:12.420749Z',
        depositType: 'INTENTS', recipientType: 'CONFIDENTIAL_INTENTS',
        originAsset: 'nep141:btc.omft.near', destinationAsset: 'nep141:btc.omft.near',
        amountInFormatted: '0.00544253', amountOutFormatted: '0.00544253',
        depositAddress: 'shield1',
    });
    const swap = historyItem({
        createdAt: '2026-07-08T18:06:38.646840Z',
        depositType: 'CONFIDENTIAL_INTENTS', recipientType: 'CONFIDENTIAL_INTENTS',
        originAsset: 'nep141:btc.omft.near', destinationAsset: 'nep141:wrap.near',
        amountInFormatted: '0.00100000', amountOutFormatted: '178.7',
        depositAddress: 'swap1',
    });

    it('sums the closing balance of every asset the history touches', () => {
        const balances = confidentialBalancesFromItems([shielding, swap], metadataByAsset);
        expect(balances.get('nep141:btc.omft.near')).to.equal(444253n);
        expect(balances.get('nep141:wrap.near')).to.equal(178700000000000000000000000n);
    });

    it('is silent when the derived series matches the ledger', () => {
        const derived = confidentialBalancesFromItems([shielding, swap], metadataByAsset);
        expect(reconcileConfidentialBalances(derived, new Map([
            ['nep141:btc.omft.near', 444253n],
            ['nep141:wrap.near', 178700000000000000000000000n],
        ]))).to.deep.equal([]);
    });

    it('catches a history that lost its oldest items', () => {
        // Dropping the shielding leaves the swap spending BTC that was never
        // received — the balance goes negative, which is what a truncated feed
        // actually produced against real data in 2026-09.
        const truncated = confidentialBalancesFromItems([swap], metadataByAsset);
        expect(truncated.get('nep141:btc.omft.near')).to.equal(-100000n);

        expect(reconcileConfidentialBalances(truncated, new Map([
            ['nep141:btc.omft.near', 444253n],
            ['nep141:wrap.near', 178700000000000000000000000n],
        ]))).to.deep.equal([
            { assetId: 'nep141:btc.omft.near', derived: -100000n, actual: 444253n },
        ]);
    });

    it('treats an asset absent from either side as a zero balance', () => {
        expect(reconcileConfidentialBalances(new Map(), new Map([['nep141:btc.omft.near', 7n]])))
            .to.deep.equal([{ assetId: 'nep141:btc.omft.near', derived: 0n, actual: 7n }]);
        expect(reconcileConfidentialBalances(new Map([['nep141:btc.omft.near', 0n]]), new Map()))
            .to.deep.equal([]);
    });
});
