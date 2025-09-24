// Chai is provided globally by the test runner
const { expect } = window;
import {
    getAccountBalanceAtBlock,
    getAllBalances,
    detectBalanceChanges,
    discoverValuableTokens,
    findTransactionDates,
    getBlockHeightAtDate,
    findTransactionBlocks
} from './balance-tracker.js';

describe('Balance Tracker', () => {
    // Set test RPC endpoint if available
    before(() => {
        // The test runner should set this from the .env file
        if (!window.TEST_RPC_ENDPOINT) {
            window.TEST_RPC_ENDPOINT = 'https://rpc.mainnet.near.org';
        }
    });
    
    // Test with a known account that should have balance
    const TEST_ACCOUNT = 'petersalomonsen.near';
    const TEST_TOKEN_ACCOUNT = 'aurora';
    
    describe('getAccountBalanceAtBlock', () => {
        it('should fetch NEAR balance for an account at final block', async () => {
            const balance = await getAccountBalanceAtBlock(TEST_ACCOUNT, 'final');
            
            // Balance should be a string representing yoctoNEAR
            expect(balance).to.be.a('string');
            expect(BigInt(balance) > 0n).to.be.true;
        });
        
        it('should return 0 for non-existent account', async () => {
            const balance = await getAccountBalanceAtBlock('this-account-definitely-does-not-exist-12345.near', 'final');
            expect(balance).to.equal('0');
        });
    });
    
    describe('discoverValuableTokens', () => {
        it('should discover tokens for an account with known tokens', async () => {
            // aurora account should have some tokens
            const tokens = await discoverValuableTokens(TEST_TOKEN_ACCOUNT);
            
            expect(tokens).to.be.an('array');
            // Aurora account likely has at least wrap.near or other tokens
            if (tokens.length > 0) {
                expect(tokens[0]).to.include('.near');
            }
        }).timeout(10000); // Give more time for multiple token checks
        
        it('should return empty array for account with no tokens', async () => {
            const tokens = await discoverValuableTokens('this-account-definitely-does-not-exist-12345.near');
            
            expect(tokens).to.be.an('array');
            expect(tokens).to.have.length(0);
        }).timeout(10000);
    });
    
    describe('getAllBalances', () => {
        it('should fetch all balances for an account', async () => {
            const balances = await getAllBalances(TEST_ACCOUNT, 'final');
            
            expect(balances).to.have.property('near');
            expect(balances).to.have.property('fungibleTokens');
            expect(balances).to.have.property('intents');
            
            expect(balances.near).to.be.a('string');
            expect(balances.fungibleTokens).to.be.an('object');
            expect(balances.intents).to.be.an('object');
        });
    });
    
    describe('detectBalanceChanges', () => {
        it('should detect NEAR balance changes', () => {
            const balance1 = {
                near: '1000000000000000000000000', // 1 NEAR
                fungibleTokens: {},
                intents: {}
            };
            
            const balance2 = {
                near: '2000000000000000000000000', // 2 NEAR
                fungibleTokens: {},
                intents: {}
            };
            
            const changes = detectBalanceChanges(balance1, balance2);
            
            expect(changes.hasChanges).to.be.true;
            expect(changes.nearChanged).to.be.true;
            expect(changes.nearDiff.toString()).to.equal('1000000000000000000000000');
        });
        
        it('should detect no changes when balances are same', () => {
            const balance1 = {
                near: '1000000000000000000000000',
                fungibleTokens: { 'wrap.near': '500' },
                intents: {}
            };
            
            const balance2 = {
                near: '1000000000000000000000000',
                fungibleTokens: { 'wrap.near': '500' },
                intents: {}
            };
            
            const changes = detectBalanceChanges(balance1, balance2);
            
            expect(changes.hasChanges).to.be.false;
            expect(changes.nearChanged).to.be.false;
        });
        
        it('should detect token balance changes', () => {
            const balance1 = {
                near: '1000000000000000000000000',
                fungibleTokens: { 'wrap.near': '500' },
                intents: {}
            };
            
            const balance2 = {
                near: '1000000000000000000000000',
                fungibleTokens: { 'wrap.near': '600' },
                intents: {}
            };
            
            const changes = detectBalanceChanges(balance1, balance2);
            
            expect(changes.hasChanges).to.be.true;
            expect(changes.nearChanged).to.be.false;
            expect(changes.tokensChanged).to.have.property('wrap.near');
            expect(changes.tokensChanged['wrap.near'].diff.toString()).to.equal('100');
        });
    });
    
    describe('findTransactionDates', () => {
        it('should find days with balance changes', async () => {
            // Test with a very recent date range (last 2 days)
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 2);
            
            const daysWithChanges = await findTransactionDates(
                TEST_ACCOUNT,
                startDate.toISOString().split('T')[0],
                endDate.toISOString().split('T')[0]
            );
            
            expect(daysWithChanges).to.be.an('array');
            // May or may not have changes in last 2 days
            if (daysWithChanges.length > 0) {
                expect(daysWithChanges[0]).to.have.property('date');
                expect(daysWithChanges[0]).to.have.property('changes');
                expect(daysWithChanges[0]).to.have.property('startBlock');
                expect(daysWithChanges[0]).to.have.property('endBlock');
            }
        }).timeout(20000); // Give plenty of time for multiple day checks

        it.only('should track balance changes for petersalomonsen.near in July 2025', async function() {
            this.timeout(180000); // Longer timeout for binary search operations

            const accountId = 'petersalomonsen.near';
            const startDate = '2025-07-01';
            const endDate = '2025-07-08';

            // Explicitly check for these tokens that might be relevant
            const tokenContracts = [
                'wrap.near',  // wNEAR
                '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',  // USDC (hex contract ID)
            ];

            console.log(`Tracking balance changes for ${accountId} from ${startDate} to ${endDate}`);
            console.log('Checking fungible tokens:', tokenContracts.join(', '));

            // Find dates with balance changes (including tokens and Intents)
            const daysWithChanges = await findTransactionDates(accountId, startDate, endDate, tokenContracts);

            expect(daysWithChanges).to.be.an('array');
            console.log(`Found ${daysWithChanges.length} days with balance changes:`);

            // Log each date with changes and find exact transaction blocks
            for (const day of daysWithChanges) {
                console.log(`\n  Date: ${day.date}`);
                console.log(`    Block range: ${day.startBlock} to ${day.endBlock}`);

                // Check what type of changes occurred
                if (day.changes.nearChanged) {
                    const nearDiff = BigInt(day.changes.nearDiff || 0);
                    const nearDiffInNear = Number(nearDiff) / 1e24;
                    console.log(`    NEAR balance changed: ${nearDiffInNear.toFixed(6)} NEAR`);

                    // Small NEAR changes likely indicate gas fees from transactions
                    if (Math.abs(nearDiffInNear) < 0.01) {
                        console.log(`      → Likely gas fees from transactions`);
                    }
                }

                if (day.changes.tokensChanged && Object.keys(day.changes.tokensChanged).length > 0) {
                    console.log(`    Token balances changed:`);
                    for (const [tokenId, change] of Object.entries(day.changes.tokensChanged)) {
                        const diff = BigInt(change.diff);
                        let displayStr;

                        if (tokenId.length > 50) {
                            // USDC with 6 decimals
                            const beforeUSDC = Number(change.before) / 1e6;
                            const afterUSDC = Number(change.after) / 1e6;
                            const diffUSDC = Number(diff) / 1e6;
                            displayStr = `USDC: ${beforeUSDC.toFixed(2)} → ${afterUSDC.toFixed(2)} (${diffUSDC > 0 ? '+' : ''}${diffUSDC.toFixed(2)})`;
                        } else if (tokenId === 'wrap.near') {
                            // wNEAR with 24 decimals
                            const beforeNEAR = Number(BigInt(change.before) / BigInt('1000000000000000000000000'));
                            const afterNEAR = Number(BigInt(change.after) / BigInt('1000000000000000000000000'));
                            const diffNEAR = Number(diff / BigInt('1000000000000000000000000'));
                            displayStr = `wNEAR: ${beforeNEAR.toFixed(4)} → ${afterNEAR.toFixed(4)} (${diffNEAR > 0 ? '+' : ''}${diffNEAR.toFixed(4)})`;
                        } else {
                            displayStr = `${tokenId}: ${change.before} → ${change.after} (${diff > 0n ? '+' : ''}${diff})`;
                        }

                        console.log(`      ${displayStr}`);
                    }
                }

                if (day.changes.intentsChanged && Object.keys(day.changes.intentsChanged).length > 0) {
                    console.log(`    Intents positions changed:`);
                    for (const [tokenId, change] of Object.entries(day.changes.intentsChanged)) {
                        const before = change.before?.balance || '0';
                        const after = change.after?.balance || '0';

                        // Format based on token type
                        if (tokenId.includes('usdc')) {
                            const beforeUSDC = Number(before) / 1e6;
                            const afterUSDC = Number(after) / 1e6;
                            const diffUSDC = afterUSDC - beforeUSDC;
                            console.log(`      ${tokenId}: ${beforeUSDC.toFixed(2)} → ${afterUSDC.toFixed(2)} USDC (${diffUSDC > 0 ? '+' : ''}${diffUSDC.toFixed(2)})`);
                        } else if (tokenId.includes('wrap.near')) {
                            const beforeNEAR = Number(BigInt(before) / BigInt('1000000000000000000000000'));
                            const afterNEAR = Number(BigInt(after) / BigInt('1000000000000000000000000'));
                            const diffNEAR = afterNEAR - beforeNEAR;
                            console.log(`      ${tokenId}: ${beforeNEAR.toFixed(4)} → ${afterNEAR.toFixed(4)} wNEAR (${diffNEAR > 0 ? '+' : ''}${diffNEAR.toFixed(4)})`);
                        } else {
                            console.log(`      ${tokenId}: ${before} → ${after}`);
                        }
                    }
                }

                // Check if USDC and Intents changed together (indicating transfers to/from Intents)
                if (day.changes.tokensChanged &&
                    day.changes.tokensChanged['17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1']) {

                    const usdcChange = day.changes.tokensChanged['17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1'];
                    const usdcDiff = Number(usdcChange.diff) / 1e6;

                    // Check if there's a corresponding Intents USDC change
                    const intentsChanges = day.changes.intentsChanged || {};
                    const intentsUSDCTokens = Object.keys(intentsChanges).filter(k =>
                        k.includes('usdc') || k.includes('0x17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1')
                    );

                    if (intentsUSDCTokens.length > 0) {
                        console.log(`    → USDC and Intents both changed - likely transfer between them`);

                        for (const tokenId of intentsUSDCTokens) {
                            const intentsChange = intentsChanges[tokenId];
                            const intentsBefore = Number(intentsChange.before?.balance || 0) / 1e6;
                            const intentsAfter = Number(intentsChange.after?.balance || 0) / 1e6;
                            const intentsDiff = intentsAfter - intentsBefore;

                            if (Math.abs(usdcDiff + intentsDiff) < 1) {
                                // Changes roughly cancel out - transfer between USDC and Intents
                                if (usdcDiff < 0) {
                                    console.log(`      → Deposited ${Math.abs(usdcDiff).toFixed(2)} USDC to Intents`);
                                } else {
                                    console.log(`      → Withdrew ${usdcDiff.toFixed(2)} USDC from Intents`);
                                }
                            }
                        }
                    } else if (usdcDiff < 0) {
                        console.log(`    → USDC withdrawal or transfer (${usdcDiff.toFixed(2)} USDC)`);
                    } else {
                        console.log(`    → USDC deposit (+${usdcDiff.toFixed(2)} USDC)`);
                    }
                }

                // Find exact transaction blocks using binary search
                if (day.changes.hasChanges) {
                    console.log(`    Finding exact transaction blocks...`);
                    try {
                        const transactionBlocks = await findTransactionBlocks(accountId, day);

                        if (transactionBlocks.length > 0) {
                            console.log(`    Found ${transactionBlocks.length} transaction(s):`);

                            for (const tx of transactionBlocks) {
                                if (tx.type === 'near') {
                                    const nearDiff = Number(tx.change) / 1e24;
                                    console.log(`      Block ${tx.block}: NEAR balance changed by ${nearDiff.toFixed(6)} NEAR`);
                                } else if (tx.type === 'token') {
                                    const tokenName = tx.tokenId.length > 50 ? 'USDC' : tx.tokenId;
                                    const diff = Number(tx.change.diff) / (tokenName === 'USDC' ? 1e6 : 1);
                                    console.log(`      Block ${tx.block}: ${tokenName} changed by ${diff.toFixed(2)}`);
                                } else if (tx.type === 'intents_deposit') {
                                    const amount = Number(tx.amount) / 1e6;
                                    console.log(`      Block ${tx.block}: USDC deposited to Intents: ${amount.toFixed(2)} (from block ${tx.relatedBlock})`);
                                } else if (tx.type === 'intents_receipt') {
                                    console.log(`      Block ${tx.block}: Intents position updated (receipt from block ${tx.relatedBlock})`);

                                    // Show what's in Intents after the receipt
                                    if (tx.intentsChange) {
                                        for (const [tid, balance] of Object.entries(tx.intentsChange)) {
                                            if (tid.includes('usdc') || tid.includes('17208628')) {
                                                const amount = Number(balance) / 1e6;
                                                console.log(`        → USDC now in Intents: ${amount.toFixed(2)}`);
                                            }
                                        }
                                    }
                                } else if (tx.type === 'intents_withdrawal') {
                                    const tokenName = tx.tokenId.includes('usdc') || tx.tokenId.includes('17208628') ? 'USDC' :
                                                    tx.tokenId.includes('btc') ? 'BTC' : tx.tokenId;

                                    if (tokenName === 'USDC') {
                                        const before = Number(tx.change.before) / 1e6;
                                        const after = Number(tx.change.after) / 1e6;
                                        console.log(`      Block ${tx.block}: Intents ${tokenName}: ${before.toFixed(2)} → ${after.toFixed(2)} - ${tx.description}`);
                                    } else {
                                        console.log(`      Block ${tx.block}: ${tx.description}`);
                                    }
                                }
                            }
                        }
                    } catch (error) {
                        console.log(`    Error finding transaction blocks: ${error.message}`);
                    }
                }

                // Get more details about what happened on this day
                if (day.startBalance && day.endBalance) {
                    // Check Intents details
                    const startIntents = day.startBalance.intents || {};
                    const endIntents = day.endBalance.intents || {};

                    const allIntentKeys = new Set([...Object.keys(startIntents), ...Object.keys(endIntents)]);
                    if (allIntentKeys.size > 0) {
                        console.log(`    Intents details:`);
                        for (const key of allIntentKeys) {
                            const start = startIntents[key];
                            const end = endIntents[key];
                            if (start || end) {
                                const startBal = start?.balance || '0';
                                const endBal = end?.balance || '0';
                                if (startBal !== endBal) {
                                    console.log(`      ${key}: ${startBal} → ${endBal}`);
                                }
                            }
                        }
                    }
                }
            }

            // Get balances at start and end dates to verify there were changes
            const startDateObj = new Date(startDate + 'T00:00:00.000Z');
            const endDateObj = new Date(endDate + 'T23:59:59.999Z');

            const startBlockHeight = await getBlockHeightAtDate(startDateObj);
            const endBlockHeight = await getBlockHeightAtDate(endDateObj);

            console.log(`Start block height (${startDate}):`, startBlockHeight);
            console.log(`End block height (${endDate}):`, endBlockHeight);

            const startBalance = await getAllBalances(accountId, startBlockHeight);
            const endBalance = await getAllBalances(accountId, endBlockHeight);

            console.log('Start balance (NEAR):', startBalance.near);
            console.log('End balance (NEAR):', endBalance.near);

            // Log token balances if any
            if (startBalance.tokens && Object.keys(startBalance.tokens).length > 0) {
                console.log('Start token balances:', startBalance.tokens);
            }
            if (endBalance.tokens && Object.keys(endBalance.tokens).length > 0) {
                console.log('End token balances:', endBalance.tokens);
            }

            // Log Intents balances if any
            if (startBalance.intents && Object.keys(startBalance.intents).length > 0) {
                console.log('Start Intents balances:', startBalance.intents);
            }
            if (endBalance.intents && Object.keys(endBalance.intents).length > 0) {
                console.log('End Intents balances:', endBalance.intents);
            }

            // Check if there were any balance differences
            const nearBalanceChanged = startBalance.near !== endBalance.near;
            const tokenBalancesChanged = JSON.stringify(startBalance.tokens) !== JSON.stringify(endBalance.tokens);
            const balanceChanged = nearBalanceChanged || tokenBalancesChanged;

            if (balanceChanged) {
                console.log('Balance changes detected:');
                if (nearBalanceChanged) {
                    const diff = BigInt(endBalance.near) - BigInt(startBalance.near);
                    console.log(`  NEAR: ${diff > 0n ? '+' : ''}${diff.toString()} yoctoNEAR`);
                }
                expect(daysWithChanges.length).to.be.greaterThan(0, 'Should have detected days with balance changes');
            } else {
                console.log('No balance changes detected in this period');
            }

            // Verify returned structure
            daysWithChanges.forEach(day => {
                expect(day).to.have.property('date');
                expect(day).to.have.property('changes');
                expect(day).to.have.property('startBlock');
                expect(day).to.have.property('endBlock');
                expect(day.changes).to.be.an('object');
            });
        });
    });
});