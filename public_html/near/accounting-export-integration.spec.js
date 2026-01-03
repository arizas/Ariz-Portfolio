import { fetchAccountingExportJSON, convertAccountingExportToTransactions } from './accounting-export.js';

describe('accounting-export integration', function () {
    let jsonData;
    let result;
    let snapshot;
    const accountId = 'webassemblymusic-treasury.sputnik-dao.near';

    before(async function () {
        this.timeout(60000);
        jsonData = await fetchAccountingExportJSON(accountId);
        result = convertAccountingExportToTransactions(accountId, jsonData);
        
        // Load snapshot
        const snapshotResponse = await fetch(`/testdata/accountingexport/${accountId}.snapshot.json`);
        snapshot = await snapshotResponse.json();
        
        console.log('Total entries from server:', jsonData.transactions.length);
        console.log('Converted transactions:', result.transactions.length);
    });

    /**
     * Helper to reconstruct full balances from sparse data.
     * With sparse balances, empty objects mean "not queried", not "zero balance".
     * We need to carry forward values from previous entries.
     */
    function reconstructBalancesAtTimestamp(transactions, targetTimestampNs) {
        // Build cumulative balance by carrying forward unchanged values
        const fullBalance = {
            near: null,
            nearBlock: null,
            fungibleTokens: {},
            intentsTokens: {},
            stakingPools: {},
            stakingBlock: null,
        };

        // Sort by timestamp ascending
        const sortedEntries = [...transactions]
            .filter(e => e.timestamp && e.timestamp <= targetTimestampNs)
            .sort((a, b) => a.timestamp - b.timestamp);

        for (const entry of sortedEntries) {
            const after = entry.balanceAfter;
            
            // NEAR: '0' in sparse mode means "not queried", carry forward previous value
            // Only update if non-zero (was actually queried)
            if (after.near && after.near !== '0') {
                fullBalance.near = after.near;
                fullBalance.nearBlock = entry.block;
            }

            // Merge intents tokens (sparse = only changed tokens are present)
            if (after.intentsTokens && Object.keys(after.intentsTokens).length > 0) {
                Object.assign(fullBalance.intentsTokens, after.intentsTokens);
            }

            // Merge fungible tokens
            if (after.fungibleTokens && Object.keys(after.fungibleTokens).length > 0) {
                Object.assign(fullBalance.fungibleTokens, after.fungibleTokens);
            }

            // Merge staking pools
            if (after.stakingPools && Object.keys(after.stakingPools).length > 0) {
                Object.assign(fullBalance.stakingPools, after.stakingPools);
                fullBalance.stakingBlock = entry.block;
            }
        }

        return fullBalance;
    }

    it('should fetch JSON data from server', function () {
        expect(jsonData).to.have.property('accountId', accountId);
        expect(jsonData).to.have.property('transactions');
        expect(jsonData.transactions.length).to.equal(snapshot.rawEntriesCount);
    });

    it('should convert correct number of transactions', function () {
        expect(result.transactions.length).to.equal(snapshot.transactionCount);
    });

    it('should match all transactions in snapshot', function () {
        expect(result.transactions.length).to.equal(snapshot.transactions.length);
        
        for (let i = 0; i < result.transactions.length; i++) {
            const actual = result.transactions[i];
            const expected = snapshot.transactions[i];
            
            expect(actual.hash, `Transaction ${i} hash`).to.equal(expected.hash);
            expect(actual.block_height, `Transaction ${i} block_height`).to.equal(expected.block_height);
            expect(actual.action_kind, `Transaction ${i} action_kind`).to.equal(expected.action_kind);
            expect(actual.balance, `Transaction ${i} balance`).to.equal(expected.balance);
            expect(actual._near_change, `Transaction ${i} _near_change`).to.equal(expected._near_change);
        }
    });

    it('should extract correct staking pools', function () {
        const expectedPools = Object.keys(snapshot.stakingPools);
        expect(result.stakingData.size).to.equal(expectedPools.length);
        
        for (const [poolId, entries] of result.stakingData) {
            console.log(`  Pool ${poolId}: ${entries.length} entries`);
            expect(snapshot.stakingPools[poolId]).to.equal(entries.length);
        }
    });

    it('should find staking pools in balanceAfter', function () {
        const poolsFound = new Set();
        let entriesWithStakingPools = 0;
        
        for (const entry of jsonData.transactions) {
            const pools = entry.balanceAfter?.stakingPools;
            if (pools && Object.keys(pools).length > 0) {
                entriesWithStakingPools++;
                for (const poolId of Object.keys(pools)) {
                    poolsFound.add(poolId);
                }
            }
        }
        
        console.log('Entries with stakingPools in balanceAfter:', entriesWithStakingPools);
        console.log('Unique staking pools:', poolsFound.size);
        
        expect(entriesWithStakingPools).to.equal(snapshot.entriesWithStakingPools);
        expect(poolsFound.size).to.equal(Object.keys(snapshot.stakingPools).length);
    });

    it('should have correct final balances (hardcoded check)', function () {
        // Hardcoded balance values as extra quality check
        // With sparse balances, we need to reconstruct cumulative state
        // because empty objects mean "not queried", not "zero balance"
        
        // Expected balances at specific dates (hardcoded for validation)
        // Note: With sparse balances, we reconstruct the full balance state
        // by accumulating values across all entries up to the target date
        const expectedBalances = {
            '2025-08-01': {
                // Last entry with NEAR change before 2025-08-01
                near: '11202816887421076699999993',
                intentsTokens: {
                    'nep141:wrap.near': '800000000000000000000000',
                    'nep141:eth.omft.near': '15000000000000000', // Was 5000... in old data, 10000 deposited June 16, then July 23 += 5000
                },
                stakingPools: null, // Staking started 2025-08-24
            },
            '2025-09-01': {
                near: '26203628781147319699999990',
                intentsTokens: {
                    'nep141:wrap.near': '800000000000000000000000',
                    'nep141:eth.omft.near': '15000000000000000', // Still 15000... from July 23, next change Sept 5
                    'nep141:btc.omft.near': '477858',
                },
                stakingPools: {
                    'astro-stakers.poolv1.near': '1001874328671208459830101360', // ~1001.87 NEAR
                },
            },
            '2025-10-01': {
                near: '26706735845128261599999978',
                intentsTokens: {
                    'nep141:wrap.near': '800000000000000000000000',
                    'nep141:eth.omft.near': '35015088429776132',
                    'nep141:btc.omft.near': '544253',
                },
                stakingPools: {
                    'astro-stakers.poolv1.near': '1010065916953990921991392585', // ~1010.07 NEAR
                },
            },
            '2026-01-01': {
                near: '26569424128999608199999975',
                // With sparse balances, intents accumulate - they're not "cleared"
                // The block 178148637 just didn't query intents (only NEAR changed)
                intentsTokens: {
                    'nep141:wrap.near': '800000000000000000000000',
                    'nep141:eth.omft.near': '35015088429776132',
                    'nep141:btc.omft.near': '544253',
                    'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near': '124833020',
                    'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1': '119000000',
                    'nep141:xrp.omft.near': '16692367',
                    'nep141:sol.omft.near': '83424010',
                    'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near': '22543646',
                    'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near': '9999980',
                    'nep245:v2_1.omni.hot.tg:43114_11111111111111111111': '1514765442315238852',
                },
                stakingPools: {
                    'astro-stakers.poolv1.near': '1026465729513509931106759271', // ~1026.47 NEAR
                },
            },
        };
        
        // Test each date using reconstructed balances
        for (const [dateStr, expected] of Object.entries(expectedBalances)) {
            const targetTimestampNs = new Date(dateStr).getTime() * 1_000_000;
            const reconstructed = reconstructBalancesAtTimestamp(jsonData.transactions, targetTimestampNs);
            
            // Check NEAR balance
            expect(reconstructed.near, `${dateStr}: near`).to.equal(expected.near);
            
            // Check intents tokens
            for (const [token, amount] of Object.entries(expected.intentsTokens || {})) {
                expect(
                    reconstructed.intentsTokens[token],
                    `${dateStr}: intentsTokens[${token}]`
                ).to.equal(amount);
            }
            
            // Check staking
            if (expected.stakingPools === null) {
                expect(Object.keys(reconstructed.stakingPools).length, `${dateStr}: should have no staking`).to.equal(0);
            } else {
                for (const [pool, amount] of Object.entries(expected.stakingPools)) {
                    expect(
                        reconstructed.stakingPools[pool],
                        `${dateStr}: stakingPools[${pool}]`
                    ).to.equal(amount);
                }
            }
            
            console.log(`${dateStr}: NEAR=${expected.near}, IntentsCount=${Object.keys(reconstructed.intentsTokens).length}, Staking=${expected.stakingPools ? Object.values(expected.stakingPools)[0] : 'none'}`);
        }
    });
});
