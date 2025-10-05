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

        // Since intents changed, we need to search for the transaction on intents.near
        const result = await findBalanceChangingTransaction(
            'intents.near',
            balanceChange.block
        );

        console.log('Transactions:', result);

        const txHash = result?.transactions?.[0]?.hash;

        // Verify the transaction hash
        expect(txHash).to.equal('FVpxXtWnTBcKzfs4k5p4bBdfKdHpmyMjNhXYsAN2s3eT');

        // Get the balance at the block where the change occurred
        const balances = await getAllBalances(accountId, balanceChange.block);

        console.log('Balances:', balances);

        // Verify the intents balance for ethereum (eth.omft.near)
        const ethBalance = balances.intentsTokens?.['nep141:eth.omft.near'];
        expect(ethBalance).to.equal('652451094941377');
    });
});
