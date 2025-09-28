#!/usr/bin/env node

import { findLatestBalanceChangeWithExpansion, getBlockHeightAtDate, findBalanceChangingTransaction } from './balance-tracker.js';
import readline from 'readline';

// Create readline interface for prompts
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Promisify readline question
function question(prompt) {
    return new Promise(resolve => {
        rl.question(prompt, resolve);
    });
}

/**
 * Main function to find balance change transactions interactively
 */
async function findTransactionsInteractive() {
    // Get account from command line args or use default
    const accountId = process.argv[2] || 'petersalomonsen.near';

    console.log(`\n🔍 Finding balance change transactions for: ${accountId}`);
    console.log('━'.repeat(50));

    try {
        // Get current block height
        const now = new Date();
        let currentEndBlock = process.argv[3] ? parseInt(process.argv[3]) : await getBlockHeightAtDate(now);

        console.log(`\n📅 Starting from current block: ${currentEndBlock}`);
        console.log(`   Time: ${now.toISOString()}`);

        let searchCount = 0;
        let lastSearchWindow = 86400; // Initial search window (24 hours)

        while (true) {
            searchCount++;
            console.log(`\n🔎 Search #${searchCount}`);
            console.log('─'.repeat(40));

            const startSearchTime = Date.now();
            const searchStartBlock = Math.max(0, currentEndBlock - lastSearchWindow);

            console.log(`   Searching blocks ${searchStartBlock} to ${currentEndBlock}...`);

            // Find the latest balance change
            const change = await findLatestBalanceChangeWithExpansion(
                accountId,
                searchStartBlock,
                currentEndBlock
            );

            // Update search window for next time
            if (change.searchStart !== undefined) {
                lastSearchWindow = currentEndBlock - change.searchStart;
                console.log(`   📏 Next search window: ${lastSearchWindow} blocks`);
            }

            if (!change.hasChanges) {
                console.log(`\n❌ No balance changes found in the searched range.`);
                const expand = await question('\n📊 Would you like to expand the search further back? (y/n): ');
                if (expand.toLowerCase() === 'y') {
                    lastSearchWindow *= 2; // Double the search window
                    continue;
                } else {
                    break;
                }
            }

            const duration = ((Date.now() - startSearchTime) / 1000).toFixed(2);
            console.log(`   ⏱️  Search completed in ${duration}s`);

            // Display balance change summary
            console.log(`\n✅ Found balance change at block ${change.block}`);

            if (change.nearChanged) {
                console.log(`   💰 NEAR: ${formatBalance(change.nearDiff.toString())}`);
            }
            if (change.tokensChanged && Object.keys(change.tokensChanged).length > 0) {
                Object.entries(change.tokensChanged).forEach(([token, info]) => {
                    console.log(`   🪙  ${getTokenName(token)}: ${formatTokenBalance(info.diff.toString(), token)}`);
                });
            }
            if (change.intentsChanged && Object.keys(change.intentsChanged).length > 0) {
                Object.entries(change.intentsChanged).forEach(([token, info]) => {
                    console.log(`   🎯 Intent ${token}: ${info.diff}`);
                });
            }

            // Get the actual transaction
            console.log(`\n📜 Fetching transaction details...`);
            try {
                const txResult = await findBalanceChangingTransaction(accountId, change.block);

                if (txResult.transactions.length > 0) {
                    console.log(`\n🔗 Transaction(s) found:`);
                    if (txResult.transactionBlock !== txResult.receiptBlock) {
                        console.log(`   📍 Transaction at block: ${txResult.transactionBlock}`);
                        console.log(`   📍 Receipt at block: ${txResult.receiptBlock}`);
                    } else {
                        console.log(`   📍 Single-block transaction at: ${txResult.transactionBlock}`);
                    }

                    txResult.transactions.forEach((tx, index) => {
                        console.log(`\n   ${index + 1}. Hash: ${tx.hash}`);
                        console.log(`      From: ${tx.signerId}`);
                        console.log(`      To:   ${tx.receiverId}`);

                        // Show transaction type
                        if (tx.receiverId === 'intents.near') {
                            console.log(`      Type: Intents transaction`);

                            // Try to decode intents details
                            for (const action of tx.actions) {
                                if (action.FunctionCall && action.FunctionCall.methodName === 'execute_intents') {
                                    try {
                                        const decodedArgs = JSON.parse(Buffer.from(action.FunctionCall.args, 'base64').toString());
                                        if (decodedArgs.signed) {
                                            for (const signedIntent of decodedArgs.signed) {
                                                if (signedIntent.payload && signedIntent.payload.message) {
                                                    const message = JSON.parse(signedIntent.payload.message);
                                                    if (message.signer_id === accountId) {
                                                        console.log(`\n      📝 Intent Details:`);
                                                        if (message.intents) {
                                                            for (const intent of message.intents) {
                                                                if (intent.intent === 'token_diff' && intent.diff) {
                                                                    console.log(`         Token swaps:`);
                                                                    for (const [token, amount] of Object.entries(intent.diff)) {
                                                                        const tokenName = token.replace('nep141:', '');
                                                                        console.log(`           • ${tokenName}: ${amount}`);
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    } catch (e) {
                                        // Silent fail for decode errors
                                    }
                                    break;
                                }
                            }
                        } else if (tx.actions) {
                            // Show action types for regular transactions
                            const actionTypes = tx.actions.map(a => Object.keys(a)[0]).join(', ');
                            console.log(`      Actions: ${actionTypes}`);
                        }
                    });

                    // Show explorer link
                    console.log(`\n   🌐 View in explorer:`);
                    txResult.transactions.forEach((tx, index) => {
                        console.log(`      ${index + 1}. https://nearblocks.io/txns/${tx.hash}`);
                    });

                    // Store the transaction block for next search
                    change.transactionBlock = txResult.transactionBlock;
                } else {
                    console.log(`\n⚠️  No transactions found searching back from block ${change.block}`);
                }
            } catch (error) {
                console.log(`\n⚠️  Could not fetch transaction: ${error.message}`);
            }

            // Ask if user wants to continue
            console.log('\n' + '─'.repeat(40));
            const continueSearch = await question('\n🔄 Search for the next balance change? (y/n): ');

            if (continueSearch.toLowerCase() !== 'y') {
                break;
            }

            // Move to search before the transaction (not the receipt)
            if (change.transactionBlock) {
                currentEndBlock = change.transactionBlock - 1;
                console.log(`\n🔄 Moving search to end before transaction block ${change.transactionBlock}`);
            } else {
                // Fallback if no transaction was found
                currentEndBlock = change.block - 1;
                console.log(`\n🔄 Moving search to end before receipt block ${change.block}`);
            }
        }

        console.log('\n' + '━'.repeat(50));
        console.log('🏁 Search complete!\n');

    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error('\nStack trace:', error.stack);
        process.exit(1);
    } finally {
        rl.close();
    }
}

/**
 * Format NEAR balance from yoctoNEAR
 */
function formatBalance(yoctoNear) {
    const near = Number(BigInt(yoctoNear) / BigInt(1e18)) / 1e6;
    const formatted = near > 0 ? '+' + near.toFixed(6) : near.toFixed(6);
    return `${formatted} NEAR`;
}

/**
 * Format token balance based on token type
 */
function formatTokenBalance(amount, tokenContract) {
    let formatted;
    if (tokenContract.includes('17208628')) {
        // USDC has 6 decimals
        const usdc = Number(BigInt(amount) / BigInt(1e6));
        formatted = usdc.toFixed(2);
        const sign = usdc > 0 ? '+' : '';
        return `${sign}${formatted} USDC`;
    } else if (tokenContract === 'wrap.near') {
        // wNEAR has 24 decimals
        const wnear = Number(BigInt(amount) / BigInt(1e18)) / 1e6;
        formatted = wnear.toFixed(6);
        const sign = wnear > 0 ? '+' : '';
        return `${sign}${formatted} wNEAR`;
    }
    return amount;
}

/**
 * Get friendly token name
 */
function getTokenName(tokenContract) {
    if (tokenContract.includes('17208628')) return 'USDC';
    if (tokenContract === 'wrap.near') return 'wNEAR';
    return tokenContract;
}

// Run the main function
findTransactionsInteractive().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});