import { convertAccountingExportToTransactions, mergeTransactions, mergeFungibleTokenTransactions, mergeStakingEntries } from './accounting-export.js';
import treasuryTestData from '../../testdata/accountingexport/accounts_webassemblymusic-treasury.sputnik-dao.near_download_json.json' with { type: 'json' };

// Sample JSON data based on actual API response
const sampleJSON = {
    accountId: 'test.near',
    transactions: [
        {
            block: 139109372,
            transactionBlock: 139109372,
            timestamp: 1644163634664000000,
            transactionHashes: ['313xyjsV4BoP3jfwU4U4Vsy3zRvyWDeUwofriQQxhyks'],
            transactions: [
                {
                    hash: '313xyjsV4BoP3jfwU4U4Vsy3zRvyWDeUwofriQQxhyks',
                    signerId: 'test.near',
                    receiverId: 'arizportfolio.near',
                    actions: [{ Transfer: { deposit: '203832280312985572347076' } }]
                }
            ],
            transfers: [
                {
                    type: 'near',
                    direction: 'in',
                    amount: '8906490770918161159160',
                    counterparty: 'system',
                    txHash: '313xyjsV4BoP3jfwU4U4Vsy3zRvyWDeUwofriQQxhyks'
                }
            ],
            balanceAfter: {
                near: '1150790343818945510719176692',
                fungibleTokens: {},
                stakingPools: {}
            }
        },
        {
            block: 139705846,
            transactionBlock: 139705846,
            timestamp: 1644839635502000000,
            transactionHashes: ['BcMnYCtiz9dvZqb1GatLPJyxEJ37dwjso4fKepEb4uRc'],
            transactions: [],
            transfers: [
                {
                    type: 'ft',
                    direction: 'in',
                    amount: '1742558822',
                    counterparty: 'v2.ref-finance.near',
                    tokenId: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
                    txHash: 'BcMnYCtiz9dvZqb1GatLPJyxEJ37dwjso4fKepEb4uRc'
                }
            ],
            balanceAfter: {
                near: '1150708195750105919347618428',
                fungibleTokens: {
                    '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1': '1742558922'
                },
                stakingPools: {}
            }
        }
    ]
};

// Sample JSON with staking data
const sampleJSONWithStaking = {
    accountId: 'test.near',
    transactions: [
        {
            block: 47865600,
            transactionBlock: null,
            timestamp: 1631761029519293000,
            transactionHashes: [],
            transactions: [],
            transfers: [
                {
                    type: 'staking_reward',
                    direction: 'in',
                    amount: '200047148588448587051584421',
                    counterparty: 'binancestaking.poolv1.near',
                    tokenId: 'binancestaking.poolv1.near',
                    memo: 'staking_reward'
                }
            ],
            balanceBefore: {
                near: '0',
                stakingPools: {
                    'binancestaking.poolv1.near': '104796729856294543352453113'
                }
            },
            balanceAfter: {
                near: '0',
                fungibleTokens: {},
                stakingPools: {
                    'binancestaking.poolv1.near': '304843878444743130404037534'
                }
            },
            changes: {
                stakingChanged: {
                    'binancestaking.poolv1.near': {
                        start: '104796729856294543352453113',
                        end: '304843878444743130404037534',
                        diff: '200047148588448587051584421'
                    }
                }
            }
        },
        {
            block: 47908800,
            transactionBlock: null,
            timestamp: 1631807531995206000,
            transactionHashes: [],
            transactions: [],
            transfers: [
                {
                    type: 'staking_reward',
                    direction: 'in',
                    amount: '44992177984055412167995',
                    counterparty: 'binancestaking.poolv1.near',
                    tokenId: 'binancestaking.poolv1.near',
                    memo: 'staking_reward'
                }
            ],
            balanceAfter: {
                near: '0',
                fungibleTokens: {},
                stakingPools: {
                    'binancestaking.poolv1.near': '304888870622727185816205529'
                }
            },
            changes: {
                stakingChanged: {
                    'binancestaking.poolv1.near': {
                        start: '304843878444743130404037534',
                        end: '304888870622727185816205529',
                        diff: '44992177984055412167995'
                    }
                }
            }
        },
        {
            block: 47952000,
            transactionBlock: null,
            timestamp: 1631850299015000000,
            transactionHashes: [],
            transactions: [],
            transfers: [
                {
                    type: 'staking_reward',
                    direction: 'in',
                    amount: '46245759413340493063198',
                    counterparty: 'binancestaking.poolv1.near',
                    tokenId: 'binancestaking.poolv1.near',
                    memo: 'staking_reward'
                }
            ],
            balanceAfter: {
                near: '0',
                fungibleTokens: {},
                stakingPools: {
                    'binancestaking.poolv1.near': '304935116382140526309268727'
                }
            },
            changes: {
                stakingChanged: {
                    'binancestaking.poolv1.near': {
                        start: '304888870622727185816205529',
                        end: '304935116382140526309268727',
                        diff: '46245759413340493063198'
                    }
                }
            }
        }
    ]
};

describe('accounting-export (JSON)', () => {
    describe('convertAccountingExportToTransactions', () => {
        it('should convert JSON entries to transaction format', async () => {
            const { transactions, ftTransactions } = await convertAccountingExportToTransactions('test.near', sampleJSON);

            // Should have NEAR transactions
            expect(transactions.length).to.be.greaterThan(0);

            // Check transaction structure
            const tx = transactions[0];
            expect(tx).to.have.property('hash');
            expect(tx).to.have.property('block_height');
            expect(tx).to.have.property('block_timestamp');
            expect(tx).to.have.property('balance');
            expect(tx).to.have.property('action_kind');
            expect(tx).to.have.property('args');
            expect(tx._source).to.equal('accounting-export');

            // Should have fungible token transactions (USDC)
            expect(ftTransactions.length).to.be.greaterThan(0);

            // Check FT transaction structure
            const ftTx = ftTransactions[0];
            expect(ftTx).to.have.property('transaction_hash');
            expect(ftTx).to.have.property('ft');
            expect(ftTx.ft).to.have.property('contract_id');
            expect(ftTx.ft).to.have.property('symbol');
            expect(ftTx.ft).to.have.property('decimals');
        });

        it('should set correct action_kind for transfer', async () => {
            const { transactions } = await convertAccountingExportToTransactions('test.near', sampleJSON);

            const transferTx = transactions.find(tx => tx.hash === '313xyjsV4BoP3jfwU4U4Vsy3zRvyWDeUwofriQQxhyks');
            expect(transferTx.action_kind).to.equal('TRANSFER');
        });

        it('should include signer and receiver from transaction details', async () => {
            const { transactions } = await convertAccountingExportToTransactions('test.near', sampleJSON);

            const tx = transactions.find(tx => tx.hash === '313xyjsV4BoP3jfwU4U4Vsy3zRvyWDeUwofriQQxhyks');
            expect(tx.signer_id).to.equal('test.near');
            expect(tx.receiver_id).to.equal('arizportfolio.near');
        });
    });

    describe('mergeTransactions', () => {
        it('should merge new transactions with existing', () => {
            const existing = [
                { hash: 'hash1', block_height: 100, balance: '100' },
                { hash: 'hash2', block_height: 90, balance: '90' }
            ];

            const newTx = [
                { hash: 'hash2', block_height: 90, balance: '95' }, // Update
                { hash: 'hash3', block_height: 110, balance: '110' } // New
            ];

            const merged = mergeTransactions(existing, newTx);

            expect(merged.length).to.equal(3);
            // Should be sorted by block_height descending
            expect(merged[0].hash).to.equal('hash3');
            expect(merged[1].hash).to.equal('hash1');
            expect(merged[2].hash).to.equal('hash2');
            // New transaction should overwrite existing
            expect(merged[2].balance).to.equal('95');
        });
    });

    describe('mergeFungibleTokenTransactions', () => {
        it('should merge FT transactions using hash+contract as key', () => {
            const existing = [
                { transaction_hash: 'hash1', ft: { contract_id: 'usdc.near' }, balance: '100', block_height: 100 }
            ];

            const newTx = [
                { transaction_hash: 'hash1', ft: { contract_id: 'usdc.near' }, balance: '110', block_height: 100 }, // Update
                { transaction_hash: 'hash1', ft: { contract_id: 'usdt.near' }, balance: '50', block_height: 100 } // New (different token)
            ];

            const merged = mergeFungibleTokenTransactions(existing, newTx);

            expect(merged.length).to.equal(2);
        });
    });

    describe('staking data extraction', () => {
        it('should extract staking data from JSON', async () => {
            const { transactions, ftTransactions, stakingData } = await convertAccountingExportToTransactions('test.near', sampleJSONWithStaking);

            // Should have no NEAR transactions (only staking)
            expect(transactions.length).to.equal(0);
            // Should have no FT transactions
            expect(ftTransactions.length).to.equal(0);

            // Should have staking data for one pool
            expect(stakingData.size).to.equal(1);
            expect(stakingData.has('binancestaking.poolv1.near')).to.be.true;

            const poolEntries = stakingData.get('binancestaking.poolv1.near');
            expect(poolEntries.length).to.equal(3);

            // Check staking entry structure
            const entry = poolEntries[0]; // Highest block first
            expect(entry).to.have.property('timestamp');
            expect(entry).to.have.property('balance');
            expect(entry).to.have.property('block_height');
            expect(entry).to.have.property('earnings');
            expect(entry._source).to.equal('accounting-export');
            expect(entry._isStakingReward).to.be.true;
        });

        it('should calculate earnings correctly', async () => {
            const { stakingData } = await convertAccountingExportToTransactions('test.near', sampleJSONWithStaking);

            const poolEntries = stakingData.get('binancestaking.poolv1.near');

            // Entries are sorted by block_height descending (newest first)
            expect(poolEntries[0].block_height).to.equal(47952000);
            expect(poolEntries[1].block_height).to.equal(47908800);
            expect(poolEntries[2].block_height).to.equal(47865600);

            // Last entry (oldest) should have 0 earnings
            expect(poolEntries[2].earnings).to.equal(0);

            // Second entry should have earnings from difference
            // 304888870622727185816205529 - 304843878444743130404037534 = ~44992...
            expect(poolEntries[1].earnings).to.be.greaterThan(0);
        });
    });

    describe('mergeStakingEntries', () => {
        it('should merge staking entries by block height', () => {
            const existing = [
                { block_height: 100, balance: 1000, deposit: 0, withdrawal: 0, earnings: 0 },
                { block_height: 90, balance: 900, deposit: 0, withdrawal: 0, earnings: 0 }
            ];

            const newEntries = [
                { block_height: 100, balance: 1050, deposit: 0, withdrawal: 0, earnings: 0 }, // Update
                { block_height: 110, balance: 1100, deposit: 0, withdrawal: 0, earnings: 0 } // New
            ];

            const merged = mergeStakingEntries(existing, newEntries);

            expect(merged.length).to.equal(3);
            // Should be sorted by block_height descending
            expect(merged[0].block_height).to.equal(110);
            expect(merged[1].block_height).to.equal(100);
            expect(merged[2].block_height).to.equal(90);
            // New entry should overwrite existing at block 100
            expect(merged[1].balance).to.equal(1050);
        });

        it('should recalculate earnings correctly after merge with deposit', () => {
            // Simulates merging OLD data (no deposit tracked) with NEW data (deposit tracked)
            // This is the bug scenario: old data has 1000 NEAR earnings, should be ~0 after fix

            // OLD data: epoch entries without deposit entry
            const existing = [
                // After deposit epoch - OLD: incorrect earnings of 1000 NEAR (didn't subtract deposit)
                {
                    block_height: 161870400,
                    balance: 1442967093064936394199457858, // ~1442.9 NEAR
                    deposit: 0,
                    withdrawal: 0,
                    earnings: 1000118064229313394572005863 // WRONG: includes deposit amount
                },
                // Before deposit epoch
                {
                    block_height: 161827200,
                    balance: 442813251789670864000720706, // ~442.8 NEAR
                    deposit: 0,
                    withdrawal: 0,
                    earnings: 35777045952135626730289 // ~0.036 NEAR
                }
            ];

            // NEW data: includes deposit entry with correct deposit amount
            const newEntries = [
                // After deposit epoch
                {
                    block_height: 161870400,
                    balance: 1442967093064936394199457858,
                    deposit: 0,
                    withdrawal: 0,
                    earnings: 0 // Will be recalculated
                },
                // Deposit entry - this is NEW, has the deposit tracked
                {
                    block_height: 161869264,
                    balance: 1442848977056627936899944430, // ~1442.8 NEAR after deposit
                    deposit: 1000000000000000000000000000, // 1000 NEAR
                    withdrawal: 0,
                    earnings: 0 // Will be recalculated
                },
                // Before deposit epoch
                {
                    block_height: 161827200,
                    balance: 442813251789670864000720706,
                    deposit: 0,
                    withdrawal: 0,
                    earnings: 0 // Will be recalculated
                }
            ];

            const merged = mergeStakingEntries(existing, newEntries);

            // Should have all 3 entries
            expect(merged.length).to.equal(3);
            expect(merged[0].block_height).to.equal(161870400);
            expect(merged[1].block_height).to.equal(161869264);
            expect(merged[2].block_height).to.equal(161827200);

            // Check that deposit entry has correct deposit value
            expect(merged[1].deposit).to.equal(1000000000000000000000000000);

            // Calculate total earnings
            let totalEarnings = 0;
            for (const entry of merged) {
                totalEarnings += entry.earnings;
            }

            // Total earnings should be small (~0.15 NEAR from actual staking rewards)
            // NOT ~1000 NEAR (the OLD incorrect value)
            expect(totalEarnings / 1e24, 'Total earnings after merge should be ~0.15 NEAR').to.be.closeTo(0.15, 0.1);
            expect(totalEarnings / 1e24, 'Total earnings should NOT be ~1000 NEAR').to.be.lessThan(10);

            // Verify individual earnings were recalculated correctly
            // Entry 161870400: earnings = 1442967... - 1442848... - 0 + 0 = ~0.118 NEAR
            expect(merged[0].earnings / 1e24).to.be.closeTo(0.118, 0.01);

            // Entry 161869264: earnings = 1442848... - 442813... - 1000e24 + 0 = ~0.036 NEAR
            expect(merged[1].earnings / 1e24).to.be.closeTo(0.036, 0.01);

            // Entry 161827200: earnings = 0 (oldest entry)
            expect(merged[2].earnings).to.equal(0);
        });
    });

    describe('staking deposit with proper balanceBefore/balanceAfter tracking', () => {
        // Tests that staking deposits are correctly tracked when the server includes
        // stakingPools in balanceBefore/balanceAfter for deposit_and_stake transactions.
        // Based on petermusic.near data from 2025-08-30.
        const stakingDepositData = {
            accountId: 'petermusic.near',
            transactions: [
                // Before withdrawal - staking balance shown
                {
                    block: 161827200,
                    transactionBlock: null,
                    timestamp: 1756537836786728200,
                    transactionHashes: [],
                    transactions: [],
                    transfers: [
                        {
                            type: 'staking_reward',
                            direction: 'in',
                            amount: '40220146728449081402349',
                            counterparty: 'astro-stakers.poolv1.near',
                            tokenId: 'astro-stakers.poolv1.near',
                            memo: 'staking_reward'
                        }
                    ],
                    balanceAfter: {
                        near: '0',
                        fungibleTokens: {},
                        intentsTokens: {},
                        stakingPools: {
                            'astro-stakers.poolv1.near': '442813251789670864000720706' // ~442.8 NEAR
                        }
                    },
                    changes: {
                        stakingChanged: {
                            'astro-stakers.poolv1.near': {
                                start: '442777474743718728373989417',
                                end: '442813251789670864000720706',
                                diff: '35777045952135626730289'
                            }
                        }
                    }
                },
                // Deposit transaction - with fixed server data that includes stakingPools
                {
                    block: 161869264,
                    transactionBlock: 161869264,
                    timestamp: 1756563443054815700,
                    transactionHashes: ['ADRV4zdG7fPXQE6dSYwTkzGsueEnitznKecp89CjaAsm'],
                    transactions: [
                        {
                            hash: 'ADRV4zdG7fPXQE6dSYwTkzGsueEnitznKecp89CjaAsm',
                            signerId: 'petermusic.near',
                            receiverId: 'astro-stakers.poolv1.near',
                            actions: [
                                {
                                    FunctionCall: {
                                        args: 'e30=',
                                        deposit: '1000000000000000000000000000', // 1000 NEAR
                                        gas: 50000000000000,
                                        method_name: 'deposit_and_stake'
                                    }
                                }
                            ]
                        }
                    ],
                    transfers: [
                        {
                            type: 'near',
                            direction: 'out',
                            amount: '1000000000000000000000000000',
                            counterparty: 'astro-stakers.poolv1.near',
                            memo: 'deposit_and_stake',
                            txHash: 'ADRV4zdG7fPXQE6dSYwTkzGsueEnitznKecp89CjaAsm'
                        }
                    ],
                    balanceBefore: {
                        near: '1008506877444837788000000001',
                        fungibleTokens: {},
                        intentsTokens: {},
                        stakingPools: {
                            'astro-stakers.poolv1.near': '442848977056627936899944429' // ~442.8 NEAR before deposit
                        }
                    },
                    balanceAfter: {
                        near: '8501757738090454900000001',
                        fungibleTokens: {},
                        intentsTokens: {},
                        stakingPools: {
                            'astro-stakers.poolv1.near': '1442848977056627936899944430' // ~1442.8 NEAR after deposit
                        }
                    },
                    changes: {
                        nearChanged: true,
                        nearDiff: '-999995448913094076800000000',
                        stakingChanged: {
                            'astro-stakers.poolv1.near': {
                                start: '442848977056627936899944429',
                                end: '1442848977056627936899944430',
                                diff: '1000000000000000000000000001'
                            }
                        }
                    }
                },
                // After deposit - staking balance shows the new total
                {
                    block: 161870400,
                    transactionBlock: null,
                    timestamp: 1756564150402017500,
                    transactionHashes: [],
                    transactions: [],
                    transfers: [
                        {
                            type: 'staking_reward',
                            direction: 'in',
                            amount: '118116008308457299513428', // This is just the epoch reward, not the full balance
                            counterparty: 'astro-stakers.poolv1.near',
                            tokenId: 'astro-stakers.poolv1.near',
                            memo: 'staking_reward'
                        }
                    ],
                    balanceAfter: {
                        near: '0',
                        fungibleTokens: {},
                        intentsTokens: {},
                        stakingPools: {
                            'astro-stakers.poolv1.near': '1442967093064936394199457858' // ~1442.9 NEAR (442.8 + 1000 deposit)
                        }
                    },
                    changes: {
                        stakingChanged: {
                            'astro-stakers.poolv1.near': {
                                start: '442849028835622999627451995',
                                end: '1442967093064936394199457858',
                                diff: '1000118064229313394572005863'
                            }
                        }
                    }
                }
            ]
        };

        it('should capture deposit from deposit_and_stake transaction and calculate earnings correctly', async () => {
            const { stakingData } = await convertAccountingExportToTransactions(
                'petermusic.near',
                stakingDepositData
            );

            expect(stakingData.has('astro-stakers.poolv1.near')).to.be.true;

            const poolEntries = stakingData.get('astro-stakers.poolv1.near');

            // Should have entries for each block with staking data
            expect(poolEntries.length).to.be.at.least(2);

            // Find the deposit entry (block 161869264)
            const depositEntry = poolEntries.find(e => e.block_height === 161869264);
            expect(depositEntry, 'Deposit entry should exist').to.exist;

            // The deposit should be captured (1000 NEAR)
            expect(depositEntry.deposit / 1e24, 'Deposit should be ~1000 NEAR').to.be.closeTo(1000, 1);

            // Find the entry after the deposit (block 161870400 - next epoch)
            const afterDepositEntry = poolEntries.find(e => e.block_height === 161870400);
            expect(afterDepositEntry, 'After deposit entry should exist').to.exist;

            // The earnings for the epoch after deposit should be small (just staking rewards)
            // NOT the full 1000 NEAR balance change
            // Balance at 161870400: ~1442.9 NEAR, Balance at 161869264: ~1442.8 NEAR
            // Difference is just the epoch reward (~0.1 NEAR), not 1000 NEAR
            expect(afterDepositEntry.earnings / 1e24, 'Earnings should be small epoch reward').to.be.closeTo(0.1, 0.5);

            // The earnings should NOT be ~1000 NEAR (the bug case)
            expect(afterDepositEntry.earnings / 1e24).to.be.lessThan(10);
        });

        it('should record zero balance for withdrawn staking pools', async () => {
            // Tests that when a pool is fully withdrawn (balance=0), the zero balance
            // is recorded so it doesn't carry forward the old non-zero balance
            const withdrawalData = {
                accountId: 'petermusic.near',
                transactions: [
                    // Before withdrawal - pool has 1000 NEAR
                    {
                        block: 161827200,
                        timestamp: 1756537836786728200,
                        transactionHashes: [],
                        transfers: [{
                            type: 'staking_reward',
                            direction: 'in',
                            amount: '100000000000000000000000',
                            counterparty: 'aurora.pool.near',
                            tokenId: 'aurora.pool.near',
                            memo: 'staking_reward'
                        }],
                        balanceAfter: {
                            stakingPools: {
                                'aurora.pool.near': '1000000000000000000000000001'
                            }
                        }
                    },
                    // Withdrawal transaction - balance becomes 0
                    {
                        block: 161868959,
                        timestamp: 1756563248491328500,
                        transactionHashes: ['54Vz7dpzRzsDaTg3C3ZBQe4Nogzc7YXZhG9Y2j24WkfF'],
                        transactions: [{
                            hash: '54Vz7dpzRzsDaTg3C3ZBQe4Nogzc7YXZhG9Y2j24WkfF',
                            signerId: 'petermusic.near',
                            receiverId: 'aurora.pool.near',
                            actions: [{
                                FunctionCall: {
                                    method_name: 'withdraw_all',
                                    deposit: '0',
                                    gas: 125000000000000
                                }
                            }]
                        }],
                        transfers: [{
                            type: 'near',
                            direction: 'in',
                            amount: '1000000000000000000000000001',
                            counterparty: 'aurora.pool.near'
                        }],
                        balanceBefore: {
                            stakingPools: {
                                'aurora.pool.near': '1000000000000000000000000001'
                            }
                        },
                        balanceAfter: {
                            stakingPools: {
                                'aurora.pool.near': '0'  // Balance is now 0
                            }
                        },
                        changes: {
                            nearChanged: true
                            // Note: stakingChanged is NOT set by server in this case
                        }
                    }
                ]
            };

            const { stakingData } = await convertAccountingExportToTransactions(
                'petermusic.near',
                withdrawalData
            );

            expect(stakingData.has('aurora.pool.near')).to.be.true;

            const poolEntries = stakingData.get('aurora.pool.near');

            // Should have entry for the withdrawal block
            const withdrawalEntry = poolEntries.find(e => e.block_height === 161868959);
            expect(withdrawalEntry, 'Withdrawal entry should exist').to.exist;

            // The balance should be 0 after withdrawal
            expect(withdrawalEntry.balance, 'Balance after withdrawal should be 0').to.equal(0);

            // The withdrawal should be recorded
            expect(withdrawalEntry.withdrawal / 1e24, 'Withdrawal should be ~1000 NEAR').to.be.closeTo(1000, 1);
        });

        it('should calculate correct earnings for deposit - reward should NOT be 1000', async () => {
            // Reproduces the bug where reward shows 1000,389 instead of 0,389 on Aug 30
            // The deposit transfer has direction='out' to astro-stakers, but earnings
            // are calculated as if no deposit was made
            const realServerData = {
                accountId: 'petermusic.near',
                transactions: [
                    // Aug 30 - epoch before deposit (block 161827200)
                    {
                        block: 161827200,
                        timestamp: 1756537836786728200,
                        transactionHashes: [],
                        transactions: [],
                        transfers: [{
                            type: 'staking_reward',
                            direction: 'in',
                            amount: '35777045952135626730289',
                            counterparty: 'astro-stakers.poolv1.near',
                            tokenId: 'astro-stakers.poolv1.near',
                            memo: 'staking_reward'
                        }],
                        balanceAfter: {
                            stakingPools: {
                                'astro-stakers.poolv1.near': '442813251789670864000720706'
                            }
                        }
                    },
                    // Aug 30 - deposit transaction (block 161869264) - REAL SERVER DATA
                    {
                        block: 161869264,
                        timestamp: 1756563443054815700,
                        transactionHashes: ['ADRV4zdG7fPXQE6dSYwTkzGsueEnitznKecp89CjaAsm'],
                        transactions: [],  // Empty in real data!
                        transfers: [
                            {
                                type: 'near',
                                direction: 'out',
                                amount: '1000000000000000000000000000',
                                counterparty: 'astro-stakers.poolv1.near',
                                memo: 'deposit_and_stake',
                                txHash: 'ADRV4zdG7fPXQE6dSYwTkzGsueEnitznKecp89CjaAsm'
                            },
                            {
                                type: 'near',
                                direction: 'in',
                                amount: '2630046502459500000000',
                                counterparty: 'system'
                            }
                        ],
                        balanceBefore: {
                            stakingPools: {
                                'astro-stakers.poolv1.near': '442848977056627936899944429'
                            }
                        },
                        balanceAfter: {
                            stakingPools: {
                                'astro-stakers.poolv1.near': '1442848977056627936899944430'
                            }
                        }
                    },
                    // Aug 30 - epoch after deposit (block 161870400)
                    {
                        block: 161870400,
                        timestamp: 1756564150402017500,
                        transactionHashes: [],
                        transactions: [],
                        transfers: [{
                            type: 'staking_reward',
                            direction: 'in',
                            amount: '118064229313394572005863',
                            counterparty: 'astro-stakers.poolv1.near',
                            tokenId: 'astro-stakers.poolv1.near',
                            memo: 'staking_reward'
                        }],
                        balanceAfter: {
                            stakingPools: {
                                'astro-stakers.poolv1.near': '1442967093064936394199457858'
                            }
                        }
                    }
                ]
            };

            const { stakingData } = await convertAccountingExportToTransactions(
                'petermusic.near',
                realServerData
            );

            const poolEntries = stakingData.get('astro-stakers.poolv1.near');
            expect(poolEntries.length).to.be.at.least(3);

            // Calculate total earnings for Aug 30 (all entries are on Aug 30)
            let totalEarnings = 0;
            for (const entry of poolEntries) {
                totalEarnings += entry.earnings;
            }

            // Total earnings should be small (~0.1 NEAR from staking rewards)
            // NOT ~1000 NEAR (which would happen if deposit wasn't detected)
            expect(totalEarnings / 1e24, 'Total earnings should be ~0.1 NEAR, not ~1000').to.be.closeTo(0.1, 1);
            expect(totalEarnings / 1e24, 'Total earnings should NOT be ~1000').to.be.lessThan(10);

            // Check that the deposit entry specifically has deposit recorded
            const depositEntry = poolEntries.find(e => e.block_height === 161869264);
            expect(depositEntry, 'Deposit entry should exist').to.exist;
            expect(depositEntry.deposit / 1e24, 'Deposit should be ~1000 NEAR').to.be.closeTo(1000, 1);
        });

    });

    describe('ARIZCREDITS balance calculation using real test data', () => {
        // Uses the actual cached API response from testdata/accountingexport/
        // This tests against real data structure including entries with transfers but no balanceAfter

        it('should use balanceAfter for FT balance when available', async () => {
            const { ftTransactions } = await convertAccountingExportToTransactions(
                treasuryTestData.accountId,
                treasuryTestData
            );

            // Filter only arizcredits.near transactions
            const arizTx = ftTransactions.filter(tx => tx.ft.contract_id === 'arizcredits.near');

            // Should have 3 FT transactions for arizcredits.near
            // (blocks 168568481, 176950912, 178148635 based on actual test data)
            expect(arizTx.length).to.equal(3);

            // Transactions are sorted by block_height descending (newest first)
            // Most recent transaction should have balance 2500000 (from balanceAfter)
            expect(arizTx[0].block_height).to.equal(178148635);
            expect(arizTx[0].balance).to.equal('2500000');

            // Second transaction should have balance 2600000
            expect(arizTx[1].block_height).to.equal(176950912);
            expect(arizTx[1].balance).to.equal('2600000');

            // Third transaction should have balance 3000000
            expect(arizTx[2].block_height).to.equal(168568481);
            expect(arizTx[2].balance).to.equal('3000000');
        });

        it('should use accumulated balanceAfter even when transfer entry has empty balance', async () => {
            const { ftTransactions } = await convertAccountingExportToTransactions(
                treasuryTestData.accountId,
                treasuryTestData
            );

            // Block 151386565 has an ETH withdrawal but empty balanceAfter in THAT entry
            // The balance at this point is from the PREVIOUS balanceAfter (5000000000000000)
            // The post-withdrawal balance (0) appears in block 151386566
            const ethWithdrawal = ftTransactions.find(
                tx => tx.block_height === 151386565 && tx.ft.contract_id === 'nep141:eth.omft.near'
            );

            expect(ethWithdrawal).to.exist;
            expect(ethWithdrawal.delta_amount).to.equal('-5000000000000000');
            // Balance is the last known balance from accumulated balanceAfter data
            // This is the balance BEFORE this withdrawal (the result appears in next block)
            expect(ethWithdrawal.balance).to.equal('5000000000000000');
        });

        it('should show updated balance after multi-block transaction completes', async () => {
            const { ftTransactions } = await convertAccountingExportToTransactions(
                treasuryTestData.accountId,
                treasuryTestData
            );

            // Block 151386566 is the continuation of the withdrawal transaction
            // This entry has the actual balanceAfter showing the result (0)
            const ethPostWithdrawal = ftTransactions.find(
                tx => tx.block_height === 151386566 && tx.ft.contract_id === 'nep141:eth.omft.near'
            );

            expect(ethPostWithdrawal).to.exist;
            // This entry shows the balance after the withdrawal completed
            expect(ethPostWithdrawal.balance).to.equal('0');
        });

        it('should handle intents tokens with nep141: prefix', async () => {
            const { ftTransactions } = await convertAccountingExportToTransactions(
                treasuryTestData.accountId,
                treasuryTestData
            );

            // Check that intents tokens are processed correctly
            const intentsTokens = ftTransactions.filter(tx =>
                tx.ft.contract_id.startsWith('nep141:')
            );

            expect(intentsTokens.length).to.be.greaterThan(0);

            // All intents tokens should have valid balance (not undefined)
            for (const tx of intentsTokens) {
                expect(tx.balance).to.not.be.undefined;
            }
        });
    });
});
