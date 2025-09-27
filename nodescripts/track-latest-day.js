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

        // Find the latest balance change
        console.log(`\n⏳ Searching for latest balance change before block ${endBlock}...`);
        const startSearchTime = Date.now();
        const change = await findLatestBalanceChangeWithExpansion(accountId, startBlock, endBlock);
        const duration = ((Date.now() - startSearchTime) / 1000).toFixed(2);

        // Display results
        console.log(`\n✅ Search completed in ${duration} seconds`);
        console.log('━'.repeat(50));

        if (!change) {
            console.log(`\n📊 No balance changes detected between blocks ${startBlock} and ${endBlock}.`);
        } else {
            console.log(`\n📊 Latest balance change found:\n`);
            console.log(change);
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