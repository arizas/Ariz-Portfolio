#!/usr/bin/env node

import { findLatestBalanceChangeWithExpansion, getBlockHeightAtDate } from './balance-tracker.js';

/**
 * Main function to find the latest balance change transaction
 */
async function findLatestChange() {
    // Get account from command line args or use default
    const accountId = process.argv[2] || 'petersalomonsen.near';
    const toBlock = process.argv[3] ? parseInt(process.argv[3]) : null;

    console.log(`\n🔍 Finding latest balance change for: ${accountId}`);
    console.log('━'.repeat(50));

    try {
        let startBlock, endBlock;

        if (toBlock) {
            // Use specified block as end
            endBlock = toBlock;

            // Start from 24 hours before the specified block (approximately 86400 blocks)
            startBlock = endBlock - 86400;

            console.log(`\n🔢 Block Range:`);
            console.log(`   From Block: ${startBlock} (24h before specified)`);
            console.log(`   To Block:   ${endBlock} (specified)`);
        } else {
            // Default to current block and 24 hours ago
            const now = new Date();
            endBlock = await getBlockHeightAtDate(now);

            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            startBlock = await getBlockHeightAtDate(yesterday);

            console.log(`\n📅 Time Range (last 24 hours):`);
            console.log(`   From: ${yesterday.toISOString()}`);
            console.log(`   To:   ${now.toISOString()}`);
            console.log(`\n🔢 Block Range:`);
            console.log(`   From Block: ${startBlock}`);
            console.log(`   To Block:   ${endBlock}`);
        }

        console.log(`   Range:       ${endBlock - startBlock} blocks`);

        // Find the last 10 balance changes
        console.log(`\n⏳ Searching for the last 10 balance changes before block ${endBlock}...`);
        const startSearchTime = Date.now();

        const changes = [];
        let currentEndBlock = endBlock;
        let lastSearchWindow = 100; // Initial search window
        const maxChanges = 10;

        while (changes.length < maxChanges && currentEndBlock > 0) {
            console.log(`\n🔍 Looking for change #${changes.length + 1}...`);

            const change = await findLatestBalanceChangeWithExpansion(
                accountId,
                Math.max(0, currentEndBlock - lastSearchWindow),
                currentEndBlock
            );

            // Use the expanded window size for the next search if available
            if (change.searchStart !== undefined) {
                lastSearchWindow = currentEndBlock - change.searchStart;
                console.log(`   📏 Using window size of ${lastSearchWindow} blocks for next search`);
            }

            if (change.hasChanges) {
                changes.push(change);
                console.log(`   ✓ Found change at block ${change.block}`);

                // Display change details
                if (change.nearChanged) {
                    console.log(`     - NEAR: ${formatBalance(change.nearDiff.toString())} change`);
                }
                if (change.tokensChanged && Object.keys(change.tokensChanged).length > 0) {
                    Object.entries(change.tokensChanged).forEach(([token, info]) => {
                        console.log(`     - ${getTokenName(token)}: ${formatTokenBalance(info.diff.toString(), token)} change`);
                    });
                }
                if (change.intentsChanged && Object.keys(change.intentsChanged).length > 0) {
                    Object.entries(change.intentsChanged).forEach(([token, info]) => {
                        console.log(`     - Intent ${token}: ${info.diff} change`);
                    });
                }

                // Move to search before this change
                currentEndBlock = change.block - 1;
            } else {
                console.log(`   ✗ No more changes found`);
                break;
            }
        }

        const duration = ((Date.now() - startSearchTime) / 1000).toFixed(2);

        // Display results
        console.log(`\n✅ Search completed in ${duration} seconds`);
        console.log('━'.repeat(50));

        if (changes.length === 0) {
            console.log(`\n📊 No balance changes detected.`);
        } else {
            console.log(`\n📊 Found ${changes.length} balance change${changes.length === 1 ? '' : 's'}:\n`);

            changes.forEach((change, index) => {
                console.log(`${index + 1}. Block ${change.block}:`);
                if (change.nearChanged) {
                    const diff = change.nearDiff;
                    console.log(`   - NEAR: ${diff > 0 ? '+' : ''}${formatBalance(diff.toString())}`);
                }
                if (change.tokensChanged && Object.keys(change.tokensChanged).length > 0) {
                    Object.entries(change.tokensChanged).forEach(([token, info]) => {
                        const diff = info.diff;
                        console.log(`   - ${getTokenName(token)}: ${diff > 0 ? '+' : ''}${formatTokenBalance(diff.toString(), token)}`);
                    });
                }
                if (change.intentsChanged && Object.keys(change.intentsChanged).length > 0) {
                    Object.entries(change.intentsChanged).forEach(([token, info]) => {
                        const diff = info.diff;
                        console.log(`   - Intent ${token}: ${diff > 0 ? '+' : ''}${diff}`);
                    });
                }
                console.log();
            });
        }

        console.log('━'.repeat(50));
        console.log('🏁 Search complete!\n');

    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error('\nStack trace:', error.stack);
        process.exit(1);
    }
}

/**
 * Format NEAR balance from yoctoNEAR
 */
function formatBalance(yoctoNear) {
    const near = Number(BigInt(yoctoNear) / BigInt(1e18)) / 1e6;
    return `${near.toFixed(6)} NEAR`;
}

/**
 * Format token balance based on token type
 */
function formatTokenBalance(amount, tokenContract) {
    if (tokenContract.includes('17208628')) {
        // USDC has 6 decimals
        const usdc = Number(BigInt(amount) / BigInt(1e6));
        return `${usdc.toFixed(2)} USDC`;
    } else if (tokenContract === 'wrap.near') {
        // wNEAR has 24 decimals
        const wnear = Number(BigInt(amount) / BigInt(1e18)) / 1e6;
        return `${wnear.toFixed(6)} wNEAR`;
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
findLatestChange().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});