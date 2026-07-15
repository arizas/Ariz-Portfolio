import {
    formattedAmountToRaw,
    confidentialMovementsForItem,
    deriveConfidentialRecords,
    deriveConfidentialFtTransactions,
    isDerivedConfidentialFtTransaction,
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
