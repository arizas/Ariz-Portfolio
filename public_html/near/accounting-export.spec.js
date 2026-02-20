import { convertAccountingExportToTransactions, mergeTransactions, mergeFungibleTokenTransactions, mergeStakingEntries, isV2Format, convertV2ToInternalFormat } from './accounting-export.js';
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

            // Earnings come from the staking_reward transfer amount for each entry
            expect(poolEntries[2].earnings).to.equal(Number(BigInt('200047148588448587051584421')));
            expect(poolEntries[1].earnings).to.equal(Number(BigInt('44992177984055412167995')));
            expect(poolEntries[0].earnings).to.equal(Number(BigInt('46245759413340493063198')));
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

        it('should preserve correct earnings from new entries after merge with deposit', () => {
            // Simulates merging OLD data (incorrect earnings) with NEW data (correct earnings from API)
            // New entries have correct earnings from staking_reward transfer amounts

            // OLD data: epoch entries without deposit entry, incorrect earnings
            const existing = [
                {
                    block_height: 161870400,
                    balance: 1442967093064936394199457858,
                    deposit: 0,
                    withdrawal: 0,
                    earnings: 1000118064229313394572005863 // WRONG: includes deposit amount
                },
                {
                    block_height: 161827200,
                    balance: 442813251789670864000720706,
                    deposit: 0,
                    withdrawal: 0,
                    earnings: 35777045952135626730289
                }
            ];

            // NEW data: includes deposit entry with correct earnings from API
            const newEntries = [
                // After deposit epoch - earnings from staking_reward transfer amount
                {
                    block_height: 161870400,
                    balance: 1442967093064936394199457858,
                    deposit: 0,
                    withdrawal: 0,
                    earnings: 118116008308457299513428 // ~0.118 NEAR (correct from transfer.amount)
                },
                // Deposit entry - no staking_reward transfer, so earnings = 0
                {
                    block_height: 161869264,
                    balance: 1442848977056627936899944430,
                    deposit: 1000000000000000000000000000, // 1000 NEAR
                    withdrawal: 0,
                    earnings: 0
                },
                // Before deposit epoch - earnings from staking_reward transfer amount
                {
                    block_height: 161827200,
                    balance: 442813251789670864000720706,
                    deposit: 0,
                    withdrawal: 0,
                    earnings: 35777045952135626730289 // ~0.036 NEAR
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

            // Verify individual earnings from new entries were preserved
            expect(merged[0].earnings / 1e24).to.be.closeTo(0.118, 0.01);
            expect(merged[1].earnings).to.equal(0); // Deposit entry, no staking reward
            expect(merged[2].earnings / 1e24).to.be.closeTo(0.036, 0.01);
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

    describe('V2 format support', () => {
        // Sample V2 format data
        const sampleV2Data = {
            version: 2,
            accountId: 'test.near',
            records: [
                {
                    block_height: 148439687,
                    block_timestamp: '2024-01-15T10:30:00.000Z',
                    tx_hash: 'ASqEerd123',
                    tx_block: 148439686,
                    signer_id: 'alice.near',
                    receiver_id: 'bob.near',
                    predecessor_id: 'alice.near',
                    token_id: 'near',
                    receipt_id: 'receipt123',
                    counterparty: 'bob.near',
                    amount: '-1000000000000000000000000',
                    balance_before: '5000000000000000000000000',
                    balance_after: '4000000000000000000000000'
                },
                {
                    block_height: 148439687,
                    block_timestamp: '2024-01-15T10:30:00.000Z',
                    tx_hash: 'ASqEerd123',
                    tx_block: 148439686,
                    signer_id: 'alice.near',
                    receiver_id: 'bob.near',
                    predecessor_id: 'alice.near',
                    token_id: 'usdc.near',
                    receipt_id: 'receipt124',
                    counterparty: 'bob.near',
                    amount: '1000000',
                    balance_before: '0',
                    balance_after: '1000000'
                },
                {
                    block_height: 148440000,
                    block_timestamp: '2024-01-15T10:35:00.000Z',
                    tx_hash: 'BcMnYCtiz9',
                    tx_block: 148440000,
                    signer_id: 'test.near',
                    receiver_id: 'pool.near',
                    predecessor_id: 'test.near',
                    token_id: 'astro-stakers.poolv1.near',
                    receipt_id: 'receipt125',
                    counterparty: 'astro-stakers.poolv1.near',
                    amount: '50000000000000000000000',
                    balance_before: '100000000000000000000000000',
                    balance_after: '100050000000000000000000000',
                    memo: 'staking_reward'
                }
            ],
            metadata: { firstBlock: 148439687, lastBlock: 148440000, totalRecords: 3 }
        };

        describe('isV2Format', () => {
            it('should detect V2 format', () => {
                expect(isV2Format(sampleV2Data)).to.be.true;
            });

            it('should reject V1 format (no version)', () => {
                const v1Data = { accountId: 'test.near', transactions: [] };
                expect(isV2Format(v1Data)).to.be.false;
            });

            it('should reject data with version but no records array', () => {
                const badData = { version: 2, transactions: [] };
                expect(isV2Format(badData)).to.be.false;
            });

            it('should reject data with records but wrong version', () => {
                const badData = { version: 1, records: [] };
                expect(isV2Format(badData)).to.be.false;
            });
        });

        describe('convertV2ToInternalFormat', () => {
            it('should convert V2 data to V1-like structure', () => {
                const result = convertV2ToInternalFormat(sampleV2Data);

                expect(result.accountId).to.equal('test.near');
                expect(result.transactions).to.be.an('array');
                expect(result.metadata.totalTransactions).to.equal(2); // 2 blocks
            });

            it('should group records by block_height', () => {
                const result = convertV2ToInternalFormat(sampleV2Data);

                // Block 148439687 has 2 records (NEAR and USDC)
                const block1 = result.transactions.find(t => t.block === 148439687);
                expect(block1.transfers.length).to.equal(2);

                // Block 148440000 has 1 record (staking)
                const block2 = result.transactions.find(t => t.block === 148440000);
                expect(block2.transfers.length).to.equal(1);
            });

            it('should convert block_timestamp to nanoseconds', () => {
                const result = convertV2ToInternalFormat(sampleV2Data);
                const entry = result.transactions[0];

                // '2024-01-15T10:30:00.000Z' -> 1705314600000 ms -> 1705314600000000000 ns
                expect(entry.timestamp).to.equal(new Date('2024-01-15T10:30:00.000Z').getTime() * 1_000_000);
            });

            it('should determine direction from amount sign', () => {
                const result = convertV2ToInternalFormat(sampleV2Data);
                const block1 = result.transactions.find(t => t.block === 148439687);

                // NEAR transfer: amount is negative -> direction is 'out'
                const nearTransfer = block1.transfers.find(t => t.type === 'near');
                expect(nearTransfer.direction).to.equal('out');
                expect(nearTransfer.amount).to.equal('1000000000000000000000000'); // absolute value

                // USDC transfer: amount is positive -> direction is 'in'
                const ftTransfer = block1.transfers.find(t => t.type === 'ft');
                expect(ftTransfer.direction).to.equal('in');
                expect(ftTransfer.amount).to.equal('1000000');
            });

            it('should build balance snapshots from records', () => {
                const result = convertV2ToInternalFormat(sampleV2Data);
                const block1 = result.transactions.find(t => t.block === 148439687);

                expect(block1.balanceBefore.near).to.equal('5000000000000000000000000');
                expect(block1.balanceAfter.near).to.equal('4000000000000000000000000');
                expect(block1.balanceAfter.fungibleTokens['usdc.near']).to.equal('1000000');
            });

            it('should categorize staking pool tokens correctly', () => {
                const result = convertV2ToInternalFormat(sampleV2Data);
                const block2 = result.transactions.find(t => t.block === 148440000);

                expect(block2.transfers[0].type).to.equal('staking_reward');
                expect(block2.balanceAfter.stakingPools['astro-stakers.poolv1.near']).to.equal('100050000000000000000000000');
            });

            it('should categorize intents tokens (nep141: prefix) correctly', () => {
                const v2DataWithIntents = {
                    version: 2,
                    accountId: 'test.near',
                    records: [
                        {
                            block_height: 148439687,
                            block_timestamp: '2024-01-15T10:30:00.000Z',
                            tx_hash: 'abc123',
                            token_id: 'nep141:wrap.near',
                            receipt_id: 'receipt126',
                            counterparty: 'intents.near',
                            amount: '500000000000000000000000',
                            balance_before: '0',
                            balance_after: '500000000000000000000000'
                        }
                    ],
                    metadata: {}
                };

                const result = convertV2ToInternalFormat(v2DataWithIntents);
                const entry = result.transactions[0];

                expect(entry.transfers[0].type).to.equal('mt');
                expect(entry.balanceAfter.intentsTokens['nep141:wrap.near']).to.equal('500000000000000000000000');
            });

            it('should build changes object correctly', () => {
                const result = convertV2ToInternalFormat(sampleV2Data);
                const block1 = result.transactions.find(t => t.block === 148439687);

                expect(block1.changes.nearChanged).to.be.true;
                expect(block1.changes.nearDiff).to.equal('-1000000000000000000000000');
                expect(block1.changes.tokensChanged['usdc.near'].diff).to.equal('1000000');
            });

            it('should collect unique transaction hashes', () => {
                const result = convertV2ToInternalFormat(sampleV2Data);
                const block1 = result.transactions.find(t => t.block === 148439687);

                // Both records in block1 have same tx_hash, should be deduplicated
                expect(block1.transactionHashes.length).to.equal(1);
                expect(block1.transactionHashes[0]).to.equal('ASqEerd123');
            });

            it('should sort transactions by block ascending', () => {
                const result = convertV2ToInternalFormat(sampleV2Data);

                expect(result.transactions[0].block).to.equal(148439687);
                expect(result.transactions[1].block).to.equal(148440000);
            });
        });

        describe('V2 end-to-end conversion', () => {
            it('should process converted V2 data through convertAccountingExportToTransactions', async () => {
                const v1Like = convertV2ToInternalFormat(sampleV2Data);
                const { transactions, ftTransactions, stakingData } = await convertAccountingExportToTransactions('test.near', v1Like);

                // Should have NEAR transactions
                expect(transactions.length).to.be.greaterThan(0);

                // Should have FT transactions
                expect(ftTransactions.length).to.be.greaterThan(0);
                const usdcTx = ftTransactions.find(tx => tx.ft.contract_id === 'usdc.near');
                expect(usdcTx).to.exist;
                expect(usdcTx.delta_amount).to.equal('1000000');

                // Should have staking data
                expect(stakingData.has('astro-stakers.poolv1.near')).to.be.true;
            });

            it('should correctly set _near_change on NEAR transactions', async () => {
                const v1Like = convertV2ToInternalFormat(sampleV2Data);
                const { transactions } = await convertAccountingExportToTransactions('test.near', v1Like);

                const nearTx = transactions.find(tx => tx.block_height === 148439687);
                expect(nearTx._near_change).to.equal('-1000000000000000000000000');
            });
        });
    });
});
