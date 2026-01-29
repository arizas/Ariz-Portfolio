# Migration Guide: V1 to V2 Account History Format

This document describes how to migrate Ariz-Portfolio from the V1 (nested transaction) format to the V2 (flat record) format from `near-accounting-export`.

## Format Overview

### V1 Format (Current)

```json
{
  "accountId": "example.near",
  "transactions": [
    {
      "block": 148439687,
      "timestamp": 1748292366227770600,
      "transactionHashes": ["ASqEerd..."],
      "transactions": [{ "hash": "...", "signerId": "...", "receiverId": "...", "actions": [...] }],
      "transfers": [
        { "type": "near", "direction": "out", "amount": "1000000000000000000000000", "counterparty": "bob.near" }
      ],
      "balanceBefore": { "near": "5000000000000000000000000", "fungibleTokens": {}, "intentsTokens": {} },
      "balanceAfter": { "near": "4000000000000000000000000", "fungibleTokens": {}, "intentsTokens": {} },
      "changes": { "nearChanged": true, "nearDiff": "-1000000000000000000000000" }
    }
  ],
  "metadata": { "firstBlock": 100, "lastBlock": 200, "totalTransactions": 50 }
}
```

### V2 Format (New)

```json
{
  "version": 2,
  "accountId": "example.near",
  "records": [
    {
      "block_height": 148439687,
      "block_timestamp": "2024-01-15T10:30:00.000Z",
      "tx_hash": "ASqEerd...",
      "tx_block": 148439686,
      "signer_id": "alice.near",
      "receiver_id": "bob.near",
      "predecessor_id": "alice.near",
      "token_id": "near",
      "receipt_id": "receipt123",
      "counterparty": "bob.near",
      "amount": "-1000000000000000000000000",
      "balance_before": "5000000000000000000000000",
      "balance_after": "4000000000000000000000000"
    }
  ],
  "metadata": { "firstBlock": 100, "lastBlock": 200, "totalRecords": 75 }
}
```

## Key Differences

| Aspect | V1 | V2 |
|--------|----|----|
| Version marker | None | `version: 2` |
| Data array | `transactions` | `records` |
| Structure | Nested (one entry per block with all tokens) | Flat (one record per token change) |
| Timestamp | Nanoseconds integer | ISO 8601 string |
| Block field | `block` | `block_height` |
| Transfer direction | `transfers[].direction: "in"/"out"` | `amount` sign (positive=in, negative=out) |
| Balance tracking | `balanceBefore`/`balanceAfter` objects with all tokens | `balance_before`/`balance_after` per record |
| Token identification | `transfers[].tokenId` or nested in balance objects | `token_id` field on each record |
| Metadata | `totalTransactions` | `totalRecords` |

## Field Mapping

### From V1 Entry to V2 Record

| V1 Field Path | V2 Field | Notes |
|---------------|----------|-------|
| `block` | `block_height` | Direct mapping |
| `timestamp` | `block_timestamp` | Convert: nanoseconds to ISO 8601 |
| `transactionHashes[0]` | `tx_hash` | First hash, or null |
| `transactionBlock` | `tx_block` | May differ from block_height |
| `transactions[0].signerId` | `signer_id` | From nested transaction |
| `transactions[0].receiverId` | `receiver_id` | From nested transaction |
| (new field) | `predecessor_id` | Receipt predecessor |
| `transfers[].tokenId` | `token_id` | "near" for native NEAR |
| (from receipt) | `receipt_id` | Receipt identifier |
| `transfers[].counterparty` | `counterparty` | Direct mapping |
| `transfers[].amount` + `direction` | `amount` | Negative if direction="out" |
| `balanceBefore.near` | `balance_before` | Per-token, not object |
| `balanceAfter.near` | `balance_after` | Per-token, not object |

### Token ID Mapping

| V1 Location | V2 `token_id` Value |
|-------------|---------------------|
| `balanceAfter.near` | `"near"` |
| `balanceAfter.fungibleTokens["usdc.near"]` | `"usdc.near"` |
| `balanceAfter.intentsTokens["nep141:wrap.near"]` | `"nep141:wrap.near"` |
| `balanceAfter.stakingPools["pool.near"]` | `"pool.near"` |

## Migration Steps for Ariz-Portfolio

### 1. Update Format Detection

In `accounting-export.js`, add version detection:

```javascript
function isV2Format(data) {
    return data.version === 2 && Array.isArray(data.records);
}

export async function fetchAccountingExportJSON(accountId) {
    const response = await fetch(`${BASE_URL}/accounts/${accountId}/download/json`);
    const data = await response.json();

    if (isV2Format(data)) {
        return convertV2ToInternalFormat(data);
    }

    // Legacy V1 handling
    return data;
}
```

### 2. Create V2 Converter Function

Add a new converter that transforms V2 records to the internal format:

```javascript
function convertV2ToInternalFormat(v2Data) {
    const entries = [];

    // Group records by block_height
    const byBlock = new Map();
    for (const record of v2Data.records) {
        const block = record.block_height;
        if (!byBlock.has(block)) {
            byBlock.set(block, []);
        }
        byBlock.get(block).push(record);
    }

    // Convert each block's records to V1-like entry
    for (const [block, records] of byBlock) {
        const entry = convertBlockRecordsToEntry(block, records);
        entries.push(entry);
    }

    return {
        accountId: v2Data.accountId,
        transactions: entries.sort((a, b) => a.block - b.block),
        metadata: {
            ...v2Data.metadata,
            totalTransactions: entries.length
        }
    };
}

function convertBlockRecordsToEntry(block, records) {
    const firstRecord = records[0];
    const timestamp = firstRecord.block_timestamp
        ? new Date(firstRecord.block_timestamp).getTime() * 1_000_000  // Convert to nanoseconds
        : null;

    // Build transfers array
    const transfers = records.map(r => ({
        type: getTransferType(r.token_id),
        direction: BigInt(r.amount) >= 0n ? 'in' : 'out',
        amount: r.amount.replace(/^-/, ''),  // Absolute value
        counterparty: r.counterparty || '',
        tokenId: r.token_id === 'near' ? undefined : r.token_id,
        receiptId: r.receipt_id,
        txHash: r.tx_hash
    }));

    // Build balance snapshots
    const balanceBefore = { fungibleTokens: {}, intentsTokens: {}, stakingPools: {} };
    const balanceAfter = { fungibleTokens: {}, intentsTokens: {}, stakingPools: {} };

    for (const r of records) {
        if (r.token_id === 'near') {
            balanceBefore.near = r.balance_before;
            balanceAfter.near = r.balance_after;
        } else if (r.token_id.startsWith('nep141:') || r.token_id.startsWith('nep245:')) {
            balanceBefore.intentsTokens[r.token_id] = r.balance_before;
            balanceAfter.intentsTokens[r.token_id] = r.balance_after;
        } else if (isStakingPool(r.token_id)) {
            balanceBefore.stakingPools[r.token_id] = r.balance_before;
            balanceAfter.stakingPools[r.token_id] = r.balance_after;
        } else {
            balanceBefore.fungibleTokens[r.token_id] = r.balance_before;
            balanceAfter.fungibleTokens[r.token_id] = r.balance_after;
        }
    }

    // Build changes object
    const changes = buildChangesFromRecords(records);

    // Collect unique transaction hashes
    const txHashes = [...new Set(records.map(r => r.tx_hash).filter(Boolean))];

    return {
        block,
        transactionBlock: firstRecord.tx_block,
        timestamp,
        transactionHashes: txHashes,
        transactions: [],  // V2 doesn't include full transaction details
        transfers,
        balanceBefore,
        balanceAfter,
        changes
    };
}

function getTransferType(tokenId) {
    if (tokenId === 'near') return 'near';
    if (tokenId.startsWith('nep141:') || tokenId.startsWith('nep245:')) return 'mt';
    if (isStakingPool(tokenId)) return 'staking_reward';
    return 'ft';
}

function isStakingPool(tokenId) {
    return tokenId.includes('.poolv1.near') ||
           tokenId.includes('.pool.near') ||
           tokenId.endsWith('.pool.f863973.m0');
}

function buildChangesFromRecords(records) {
    const changes = {
        nearChanged: false,
        tokensChanged: {},
        intentsChanged: {},
        stakingChanged: {}
    };

    for (const r of records) {
        const diff = r.amount;

        if (r.token_id === 'near') {
            changes.nearChanged = true;
            changes.nearDiff = diff;
        } else if (r.token_id.startsWith('nep141:') || r.token_id.startsWith('nep245:')) {
            changes.intentsChanged[r.token_id] = {
                start: r.balance_before,
                end: r.balance_after,
                diff
            };
        } else if (isStakingPool(r.token_id)) {
            changes.stakingChanged[r.token_id] = {
                start: r.balance_before,
                end: r.balance_after,
                diff
            };
        } else {
            changes.tokensChanged[r.token_id] = {
                start: r.balance_before,
                end: r.balance_after,
                diff
            };
        }
    }

    return changes;
}
```

### 3. Alternative: Direct V2 Processing

Instead of converting to V1, you could process V2 records directly. This is cleaner but requires more changes:

```javascript
// For NEAR transactions
function convertV2RecordToNearTransaction(record, accountId) {
    if (record.token_id !== 'near') return null;

    const amount = BigInt(record.amount);
    const direction = amount >= 0n ? 'in' : 'out';

    return {
        block_height: record.block_height,
        block_timestamp: record.block_timestamp
            ? new Date(record.block_timestamp).getTime() * 1000  // microseconds
            : null,
        hash: record.tx_hash || `block-${record.block_height}`,
        signer_id: record.signer_id || (direction === 'out' ? accountId : record.counterparty),
        receiver_id: record.receiver_id || (direction === 'in' ? accountId : record.counterparty),
        action_kind: 'TRANSFER',
        balance: record.balance_after,
        _near_change: record.amount
    };
}

// For FT transactions
function convertV2RecordToFTTransaction(record, accountId, tokenMetadata) {
    if (record.token_id === 'near' || isStakingPool(record.token_id)) return null;

    const amount = BigInt(record.amount);
    const direction = amount >= 0n ? 'in' : 'out';

    // Handle intents token prefixes
    let contractId = record.token_id;
    if (contractId.startsWith('nep141:')) {
        contractId = contractId.substring('nep141:'.length);
    }

    const metadata = tokenMetadata[contractId] || { symbol: contractId, decimals: 24 };

    return {
        transaction_hash: record.tx_hash || `block-${record.block_height}`,
        block_height: record.block_height,
        block_timestamp: record.block_timestamp
            ? new Date(record.block_timestamp).getTime() * 1000
            : null,
        account_id: accountId,
        delta_amount: (direction === 'in' ? '' : '-') + (amount < 0n ? -amount : amount).toString(),
        involved_account_id: record.counterparty || '',
        balance: record.balance_after,
        ft: {
            contract_id: contractId,
            symbol: metadata.symbol,
            decimals: metadata.decimals
        }
    };
}

// For staking data
function convertV2RecordsToStakingData(records, accountId) {
    const stakingRecords = records.filter(r => isStakingPool(r.token_id));

    // Group by pool
    const byPool = new Map();
    for (const r of stakingRecords) {
        if (!byPool.has(r.token_id)) {
            byPool.set(r.token_id, []);
        }
        byPool.get(r.token_id).push(r);
    }

    const result = {};
    for (const [poolId, poolRecords] of byPool) {
        // Sort chronologically
        poolRecords.sort((a, b) => a.block_height - b.block_height);

        result[poolId] = poolRecords.map(r => ({
            timestamp: r.block_timestamp ? new Date(r.block_timestamp).getTime() * 1000 : null,
            balance: r.balance_after,
            block_height: r.block_height,
            // Note: deposit/withdrawal detection requires looking at transaction actions
            // which are not included in V2 records
            balance_change: r.amount
        }));
    }

    return result;
}
```

### 4. Update Tests

Add V2 format tests to `accounting-export.spec.js`:

```javascript
describe('V2 format support', () => {
    it('should detect V2 format', () => {
        const v2Data = { version: 2, records: [] };
        expect(isV2Format(v2Data)).toBe(true);

        const v1Data = { transactions: [] };
        expect(isV2Format(v1Data)).toBe(false);
    });

    it('should convert V2 NEAR record to transaction', () => {
        const record = {
            block_height: 100,
            block_timestamp: '2024-01-15T10:00:00.000Z',
            tx_hash: 'abc123',
            signer_id: 'alice.near',
            receiver_id: 'bob.near',
            predecessor_id: 'alice.near',
            token_id: 'near',
            amount: '-1000000000000000000000000',
            balance_before: '5000000000000000000000000',
            balance_after: '4000000000000000000000000'
        };

        const tx = convertV2RecordToNearTransaction(record, 'alice.near');

        expect(tx.block_height).toBe(100);
        expect(tx.hash).toBe('abc123');
        expect(tx.balance).toBe('4000000000000000000000000');
        expect(tx._near_change).toBe('-1000000000000000000000000');
    });
});
```

## Timestamp Conversion Reference

```javascript
// V1 → Internal (nanoseconds to microseconds)
const microseconds = Math.floor(nanoseconds / 1000);

// V2 → Internal (ISO string to microseconds)
const microseconds = new Date(isoString).getTime() * 1000;

// V1 → V2 (nanoseconds to ISO string)
const isoString = new Date(nanoseconds / 1_000_000).toISOString();
```

## Migration Checklist

- [ ] Add `isV2Format()` detection function
- [ ] Add V2-to-internal converter OR direct V2 processing
- [ ] Update `fetchAccountingExportJSON()` to handle both formats
- [ ] Update `convertAccountingExportToTransactions()` for V2
- [ ] Update `extractStakingData()` for V2
- [ ] Add V2 test cases
- [ ] Test with real V2 API response
- [ ] Update test data files with V2 samples

## Notes on Sparse vs Dense Balances

V2 records always include `balance_before` and `balance_after` for the specific token that changed. This is different from V1 where balances could be sparse (only changed tokens present in the snapshot).

In V2:
- Each record has its own `balance_before`/`balance_after`
- No need to track running balances across entries
- Balance reconstruction is per-token, not per-block

## API Endpoint Behavior

The API at `https://near-accounting-export.fly.dev/api/accounts/{accountId}/download/json` will return:
- V2 format for accounts synced after migration
- V2 format for all accounts (V1 files are auto-migrated on server startup)

Check `data.version === 2` to confirm V2 format.
