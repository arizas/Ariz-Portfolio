import { findLatestBalanceChangeWithExpansion, findBalanceChangingTransaction, getAllBalances } from './balance-tracker.js';

describe('Balance Tracker', function () {
    it('findLatestBalanceChangeWithExpansion finds transaction FVpxXtWnTBcKzfs4k5p4bBdfKdHpmyMjNhXYsAN2s3eT', async function () {
        const accountId = 'ariz-treasury.sputnik-dao.near';
        const endBlock = 166564800;
        const startBlock = endBlock - 1000; // Search backwards 1000 blocks

        // Find the latest balance change
        const balanceChange = await findLatestBalanceChangeWithExpansion(
            accountId,
            startBlock,
            endBlock
        );

        console.log('Balance change:', balanceChange);

        // Verify the intents balance changed
        expect(balanceChange.intentsChanged).to.deep.equal({
            'nep141:eth.omft.near': {
                start: '0',
                end: '652451094941377',
                diff: '652451094941377'
            }
        });

        // Search for transaction by checking receipts that affected our account
        const result = await findBalanceChangingTransaction(
            accountId,
            balanceChange.block
        );

        console.log('Transaction result:', result);

        // The tx_hash comes from the receipt execution outcome
        const txHash = result?.transactionHashes?.[0] || result?.transactions?.[0]?.hash;

        // Verify the transaction hash
        expect(txHash).to.equal('FVpxXtWnTBcKzfs4k5p4bBdfKdHpmyMjNhXYsAN2s3eT');

        // Get the balance at the block where the change occurred
        const balances = await getAllBalances(accountId, balanceChange.block);

        console.log('Balances:', balances);

        // Verify the intents balance for ethereum (eth.omft.near)
        const ethBalance = balances.intentsTokens?.['nep141:eth.omft.near'];
        expect(ethBalance).to.equal('652451094941377');
    });

    it('finds wrap.near deposit in intents before block 166525342', async function () {
        const accountId = 'ariz-treasury.sputnik-dao.near';
        const endBlock = 166525342;
        const startBlock = endBlock - 1000; // Search backwards 1000 blocks

        // Find the latest balance change
        const balanceChange = await findLatestBalanceChangeWithExpansion(
            accountId,
            startBlock,
            endBlock
        );

        console.log('Balance change:', balanceChange);

        // Verify that wrap.near token changed in intents
        expect(balanceChange.intentsChanged).to.have.property('nep141:wrap.near');

        const wrapChange = balanceChange.intentsChanged['nep141:wrap.near'];
        console.log('Wrap.near change:', wrapChange);

        // Verify it's a deposit (balance increased from 0 to 1 wNEAR)
        expect(wrapChange.start).to.equal('0');
        expect(wrapChange.end).to.equal('1000000000000000000000000'); // 1 wNEAR
        expect(wrapChange.diff).to.equal('1000000000000000000000000');

        // Search for transaction by checking receipts that affected our account
        const result = await findBalanceChangingTransaction(
            accountId,
            balanceChange.block
        );

        console.log('Transaction result:', result);

        // The tx_hash comes from the receipt execution outcome
        const txHash = result?.transactionHashes?.[0] || result?.transactions?.[0]?.hash;
        expect(txHash).to.not.be.undefined;

        console.log('Found transaction:', txHash);
    });
});
