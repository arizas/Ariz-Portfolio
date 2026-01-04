import { convertAccountingExportToTransactions, mergeTransactions, mergeFungibleTokenTransactions, mergeStakingEntries } from './accounting-export.js';

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
        it('should convert JSON entries to transaction format', () => {
            const { transactions, ftTransactions } = convertAccountingExportToTransactions('test.near', sampleJSON);

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

        it('should set correct action_kind for transfer', () => {
            const { transactions } = convertAccountingExportToTransactions('test.near', sampleJSON);

            const transferTx = transactions.find(tx => tx.hash === '313xyjsV4BoP3jfwU4U4Vsy3zRvyWDeUwofriQQxhyks');
            expect(transferTx.action_kind).to.equal('TRANSFER');
        });

        it('should include signer and receiver from transaction details', () => {
            const { transactions } = convertAccountingExportToTransactions('test.near', sampleJSON);

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
        it('should extract staking data from JSON', () => {
            const { transactions, ftTransactions, stakingData } = convertAccountingExportToTransactions('test.near', sampleJSONWithStaking);

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

        it('should calculate earnings correctly', () => {
            const { stakingData } = convertAccountingExportToTransactions('test.near', sampleJSONWithStaking);

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
    });
});
