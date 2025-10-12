import { findLatestBalanceChangeWithExpansion, findBalanceChangingTransaction } from './balance-tracker.js';

describe('Balance Tracker Full Discovery', function () {
    it.only('finds all transactions for ariz-treasury.sputnik-dao.near from current block', async function () {
        this.timeout(600000); // 10 minutes timeout

        const accountId = 'ariz-treasury.sputnik-dao.near';

        // The account was created around July 12, 2025
        // We know of transactions at blocks:
        // - 156307922 (USDT) - July 22, 2025
        // - 166524681 (wNEAR) - around September 2025
        // - 166564800 (ETH) - October 2, 2025
        // Hardcoded block heights for consistent test caching
        const endBlock = 167200000; // Approximately October 5, 2025
        console.log('Search end block:', endBlock);

        // Start from 100 blocks before account creation (created at block 154910444)
        const startBlock = 154910344;
        console.log('Search start block:', startBlock);

        // Start search from end block
        let searchEndBlock = endBlock;
        const allTransactions = [];
        const maxIterations = 25; // Safety limit (need at least 18 for all expected transactions)
        let iteration = 0;

        while (iteration < maxIterations) {
            iteration++;
            console.log(`\nIteration ${iteration}: Searching from block ${startBlock} to ${searchEndBlock}`);

            // Search backwards from current position
            const balanceChange = await findLatestBalanceChangeWithExpansion(
                accountId,
                startBlock, // Start from account creation
                searchEndBlock
            );

            if (!balanceChange.hasChanges) {
                console.log('No more balance changes found');
                break;
            }

            console.log(`Found balance change at block ${balanceChange.block}`);

            // Log what changed
            if (balanceChange.nearChanged) {
                console.log(`  NEAR: ${balanceChange.nearDiff}`);
            }
            if (balanceChange.tokensChanged) {
                Object.entries(balanceChange.tokensChanged).forEach(([token, info]) => {
                    console.log(`  Token ${token}: ${info.diff}`);
                });
            }
            if (balanceChange.intentsChanged) {
                Object.entries(balanceChange.intentsChanged).forEach(([token, info]) => {
                    console.log(`  Intent ${token}: ${info.diff}`);
                });
            }

            // Find the transaction that caused this balance change
            const txResult = await findBalanceChangingTransaction(
                accountId,
                balanceChange.block
            );

            if (txResult.transactionHashes && txResult.transactionHashes.length > 0) {
                console.log(`  Transaction hashes: ${txResult.transactionHashes.join(', ')}`);

                // Store transaction info
                for (const hash of txResult.transactionHashes) {
                    allTransactions.push({
                        hash,
                        block: balanceChange.block,
                        nearChanged: balanceChange.nearChanged,
                        tokensChanged: balanceChange.tokensChanged,
                        intentsChanged: balanceChange.intentsChanged
                    });
                }
            }

            // Move search window to before this transaction
            searchEndBlock = balanceChange.block - 1;

            if (searchEndBlock <= startBlock) {
                console.log('Reached start block');
                break;
            }
        }

        console.log(`\n\n=== SUMMARY ===`);
        console.log(`Total transactions found: ${allTransactions.length}`);
        console.log(`Iterations used: ${iteration}`);

        const foundHashes = allTransactions.map(tx => tx.hash);

        // Verify we found all expected transactions in reverse chronological order (backwards search)
        const expectedTransactions = [
            // Most recent first (October 2025)
            'FVpxXtWnTBcKzfs4k5p4bBdfKdHpmyMjNhXYsAN2s3eT', // 2025-10-02 - ETH deposit (intents)
            'FCebALSsaoYttAbQvUtr4qbn5HuC17QkCnHxbEsUg2TZ', // 2025-10-02 14:24:00
            '2B6szJ7VvP439MTttKzygxqiPXDMskKeScEpUKa3NXZq', // 2025-10-02 07:52:41
            '4pCWj1t1xLWb5Xb8Vsde9ibKqApkvAvkxyuv5SpEL6Gk', // 2025-10-02 07:52:17
            '4AHtMX7uRSrbqnyk2QnKArpnmrRNYVFn5s8xN6uVPugt', // wNEAR deposit (intents, September 2025)
            // August 2025
            '4ptRMEhMo47W5LDrHSenkLDrrCoZ4dfg3DLcdu9LQYjv', // 2025-08-09 12:00:13
            'DfVxYDW2GXJM2aEwNYE98xuaZtCmJdkkbdQVQFxzLVDN', // 2025-08-09 11:58:46
            // July 2025
            'E67SBzkc5vPHBu2j33h8mFNSGM8gWYFGjn4i3B3tBipL', // 2025-07-27 09:13:52
            'E5cSF9ESvGi41fxDzLDTPCwcz2RrFxXVoTSZKWEC5jpB', // 2025-07-22 06:40:27 - 995 USDT in
            '35fPAYT3qbi1epZsAkrkczHubUiWDAHbVwy685qeyznY', // 2025-07-22 06:50:11
            'DP2Gtv6ZvG9EdPP33uH1gyCqkn5qqpwgMY6cwnVm2bPd', // 2025-07-22 06:39:42 - 5 USDT in
            'D1MpwE9Q56gb9LU9TZFrU6RJYEUpHwY5nKoW5DzMCQU8', // 2025-07-22 06:48:40
            'HPuY7xuqTg3y5S7vubN17sPHx4yNaVDNAfJfpNxFEeqH', // 2025-07-13 08:29:26 - 0.5 USDT out
            'BmTQqWr3bPGsZzMdWGW2qoUuWWnHcwg1jZ9t4TyxpfA5', // 2025-07-13 08:28:53
            '8mrWZUyxexSCiuSag9Nnp1AUhJkpM4oq8ADJHiTEMQex', // 2025-07-13 08:26:56 - 0.5 USDT in
            'H95JJztPJGEdApqQPKL6ZXKJfykxCVXhBQQRpJRERJ8o', // 2025-07-12 12:59:42
            '7gm96UgYTeBYVa7QwSQ6W5smA6hYKndwXv2V4DSQUHp3', // 2025-07-12 12:59:24
            'HnsxpyRDi468vPzfzbntje5ZpzRTQ8EaZAT4q97Xz5yq', // 2025-07-12 10:07:47
            'HfmJ1xS8YkTbRj9w75C9xVKp2VxPm8Z3bNQtvwocgnqW', // 2025-07-12 - Account creation
        ];

        console.log('\nExpected transactions:');
        for (const expectedHash of expectedTransactions) {
            const found = foundHashes.includes(expectedHash);
            console.log(`  ${expectedHash}: ${found ? '✓ FOUND' : '✗ MISSING'}`);
            expect(foundHashes).to.include(expectedHash, `Expected to find transaction ${expectedHash}`);
        }

        // Print all found transactions for debugging
        console.log('\nAll found transactions:');
        allTransactions.forEach((tx, index) => {
            console.log(`  ${index + 1}. ${tx.hash} (block ${tx.block})`);
            if (tx.nearChanged) console.log(`     - NEAR changed`);
            if (tx.tokensChanged) console.log(`     - Tokens: ${Object.keys(tx.tokensChanged).join(', ')}`);
            if (tx.intentsChanged) console.log(`     - Intents: ${Object.keys(tx.intentsChanged).join(', ')}`);
        });

        // Basic sanity checks
        expect(allTransactions.length).to.be.at.least(19, 'Should find at least 19 transactions (all expected + account creation)');
        expect(iteration).to.be.lessThan(maxIterations, 'Should not hit iteration limit');

        // Expected NEAR transaction

        // HnsxpyRDi468vPzfzbntje5ZpzRTQ8EaZAT4q97Xz5yq	TRANSFER	5	0.0000446365125	arizas.near	ariz-treasury.sputnik-dao.near	154913527	2025-07-12 10:07:47
        // 7gm96UgYTeBYVa7QwSQ6W5smA6hYKndwXv2V4DSQUHp3	add_proposal	0.1	0.0003895508190335	petersalomonsen.near	ariz-treasury.sputnik-dao.near	154930347	2025-07-12 12:59:24
        // H95JJztPJGEdApqQPKL6ZXKJfykxCVXhBQQRpJRERJ8o	act_proposal	0	0.0004716373846554	petersalomonsen.near	ariz-treasury.sputnik-dao.near	154930377	2025-07-12 12:59:42
        // BmTQqWr3bPGsZzMdWGW2qoUuWWnHcwg1jZ9t4TyxpfA5	add_proposal	0.1	0.0002895290183804	arizas.near	ariz-treasury.sputnik-dao.near	155045112	2025-07-13 08:28:53
        // HPuY7xuqTg3y5S7vubN17sPHx4yNaVDNAfJfpNxFEeqH	act_proposal	0	0.0009460618372547	arizas.near	ariz-treasury.sputnik-dao.near	155045167	2025-07-13 08:29:26
        // D1MpwE9Q56gb9LU9TZFrU6RJYEUpHwY5nKoW5DzMCQU8	add_proposal	0.1	0.0003974184480155	arizas.near	ariz-treasury.sputnik-dao.near	156308732	2025-07-22 06:48:40
        // 35fPAYT3qbi1epZsAkrkczHubUiWDAHbVwy685qeyznY	act_proposal	0	0.0005075377230277	arizas.near	ariz-treasury.sputnik-dao.near	156308883	2025-07-22 06:50:11
        // E67SBzkc5vPHBu2j33h8mFNSGM8gWYFGjn4i3B3tBipL	TRANSFER	9	0.0000446365125	ariz-treasury.near	ariz-treasury.sputnik-dao.near	157030930	2025-07-27 09:13:52
        // DfVxYDW2GXJM2aEwNYE98xuaZtCmJdkkbdQVQFxzLVDN	add_proposal	0.1	0.0004280912026265	arizas.near	ariz-treasury.sputnik-dao.near	158886708	2025-08-09 11:58:46
        // 4ptRMEhMo47W5LDrHSenkLDrrCoZ4dfg3DLcdu9LQYjv	TRANSFER	0	0.0005443378068757	arizas.near	ariz-treasury.sputnik-dao.near	158886851	2025-08-09 12:00:13
        // 4pCWj1t1xLWb5Xb8Vsde9ibKqApkvAvkxyuv5SpEL6Gk	TRANSFER	0.1	0.0003200572872464	stianforland.near	ariz-treasury.sputnik-dao.near	166525343	2025-10-02 07:52:17
        // 2B6szJ7VvP439MTttKzygxqiPXDMskKeScEpUKa3NXZq	act_proposal	0	0.0003378573223142	stianforland.near	ariz-treasury.sputnik-dao.near	166525382	2025-10-02 07:52:41
        // FCebALSsaoYttAbQvUtr4qbn5HuC17QkCnHxbEsUg2TZ	TRANSFER	0	0.0012501515116849	petersalomonsen.near	ariz-treasury.sputnik-dao.near	166564508	2025-10-02 14:24:00

        // Expected fungible token transactions

        // 8mrWZUyxexSCiuSag9Nnp1AUhJkpM4oq8ADJHiTEMQex	TRANSFER	ariz-treasury.sputnik-dao.near	arizas.near	In	0.5	Tether USD (USDt)	usdt.tether-token.near	155044918	2025-07-13 08:26:56
        // HPuY7xuqTg3y5S7vubN17sPHx4yNaVDNAfJfpNxFEeqH	TRANSFER	ariz-treasury.sputnik-dao.near	arizas.near	Out	0.5	Tether USD (USDt)	usdt.tether-token.near	155045167	2025-07-13 08:29:26
        // DP2Gtv6ZvG9EdPP33uH1gyCqkn5qqpwgMY6cwnVm2bPd	TRANSFER	ariz-treasury.sputnik-dao.near	arizas.near	In	5	Tether USD (USDt)	usdt.tether-token.near	156307848	2025-07-22 06:39:42
        // E5cSF9ESvGi41fxDzLDTPCwcz2RrFxXVoTSZKWEC5jpB	TRANSFER	ariz-treasury.sputnik-dao.near	arizas.near	In	995	Tether USD (USDt)	usdt.tether-token.near	156307921	2025-07-22 06:40:27
    });
});
