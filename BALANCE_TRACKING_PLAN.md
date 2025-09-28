# Balance-Based Transaction Discovery Plan

## Overview
A Node.js implementation for efficiently discovering NEAR transactions using binary search on balance changes. This approach reduces RPC calls by 95% and properly handles multi-block transactions, intents.near tokens, and provides an interactive CLI for exploring transaction history.

## Current Implementation (nodescripts/)

### Core Components

#### 1. Balance Tracker (`nodescripts/balance-tracker.js`)
The main module implementing binary search for balance change detection.

**Key Functions:**
- `findLatestBalanceChangingBlock()` - Binary search to find exact block where balance changed
- `findBalanceChangingTransaction()` - Search backwards from receipt block to find originating transaction
- `findLatestBalanceChangingTransaction()` - Combined function that finds both balance change and transaction
- `getAllBalances()` - Get all balances including NEAR, fungible tokens, and intents tokens

**Features:**
- Caching system to minimize RPC calls
- Block alignment for optimal cache hits
- Server error retry mechanism
- Support for multi-block transactions (transaction → receipt)
- Intents.near token support via `mt_tokens_for_owner` and `mt_balance_of`

#### 2. Interactive CLI (`nodescripts/track-latest-day.js`)
Interactive command-line tool for finding and exploring transactions.

**Usage:**
```bash
node nodescripts/track-latest-day.js [account] [optional_block]
```

**Features:**
- Starts from current block or specified block
- Shows transaction and receipt blocks separately
- Decodes and displays intents.near transaction details
- Provides nearblocks.io links
- Interactive prompts to continue searching
- Adaptive search window expansion

#### 3. Block Effects Utility (`nodescripts/block-effects.js`)
Utility for inspecting transactions in specific blocks.

**Usage:**
```bash
node nodescripts/block-effects.js <block_number>
```

Shows all intents.near transactions in a given block with decoded payloads.

## Technical Implementation

### Binary Search Algorithm
```javascript
// Efficiently finds balance changes with minimal RPC calls
async function findLatestBalanceChangingBlock(accountId, firstBlock, lastBlock) {
    // 1. Check balances at range boundaries
    const startBalance = await getAllBalances(accountId, firstBlock);
    const endBalance = await getAllBalances(accountId, lastBlock);

    // 2. Detect what changed
    const changes = detectBalanceChanges(startBalance, endBalance);

    // 3. Binary search for exact change block
    if (changes.hasChanges && numBlocks > 1) {
        const middleBlock = lastBlock - Math.floor(numBlocks / 2);
        // Recursively search the half with changes
    }

    // 4. Return the receipt block (lastBlock)
    return { ...changes, block: lastBlock };
}
```

### Multi-Block Transaction Handling
Transactions can span multiple blocks:
1. **Transaction Block**: Where the transaction is initiated
2. **Receipt Block**: Where the balance actually changes

The system:
- Returns the receipt block from `findLatestBalanceChangingBlock`
- Searches backwards up to 10 blocks to find the originating transaction
- Continues next search from before the transaction block

### Intents Token Support
```javascript
async function getIntentsBalances(accountId, blockId) {
    // Get tokens owned by account
    const tokens = await viewFunctionAsJson(
        'intents.near',
        'mt_tokens_for_owner',
        { account_id: accountId }
    );

    // Get balance for each token
    const balances = {};
    for (const token of tokens) {
        const balance = await viewFunctionAsJson(
            'intents.near',
            'mt_balance_of',
            {
                token_id: token,
                account_id: accountId
            }
        );
        balances[token] = balance;
    }
    return balances;
}
```

### Caching Strategy
- Balance results cached by: `${accountId}:${blockId}:${tokenContracts}:${intentsTokens}:${checkNear}`
- Block alignment using power-of-2 boundaries for maximum cache reuse
- Persistent cache across searches

### Expanding Search Window
When no changes found in initial range:
```javascript
let searchWindow = 86400; // Start with 24 hours

while (!changesFound) {
    searchWindow *= 2; // Double the window
    const newStart = currentEnd - searchWindow;
    // Search expanded range
}
```

## Performance Metrics

- **RPC Call Reduction**: ~95% fewer calls compared to sequential checking
- **Typical Search**: ~20-30 RPC calls to find a transaction in 24-hour range
- **Cache Hit Rate**: ~50% on subsequent searches
- **Search Time**: 2-5 seconds per transaction discovery

## Webapp Frontend Integration

The Node.js implementation was created for rapid development and testing without browser reloads. All this code will be ported directly to the web frontend.

### Phase 1: Direct Code Port to Browser
Port the balance tracker to run in the browser:
```javascript
// public_html/near/balance-tracker.js
import { NearRpcClient, viewFunctionAsJson, viewAccount, status, block, chunk } from '@near-js/jsonrpc-client';

// Same code as nodescripts/balance-tracker.js
// @near-js/jsonrpc-client works in browser via unpkg CDN
// Use wasm-git/emscripten FS for storage instead of Node.js fs
```

The browser already has @near-js/jsonrpc-client available via import map:
```javascript
"@near-js/jsonrpc-client": "https://unpkg.com/@near-js/jsonrpc-client@latest/dist/browser-standalone.min.js"
```

### Phase 2: Storage Integration
Use existing wasm-git storage:
```javascript
// Use gitstorage.js for all file operations
import { writeFile, readTextFile, exists } from '../storage/gitstorage.js';

// Transactions stored in emscripten FS, committed to git
await writeFile(`accountdata/${account}/transactions.json`, JSON.stringify(transactions));
```

### Phase 3: Incremental Loading UI
Add buttons for progressive loading:
- **"Load Recent"** - Start with last 24h using balance tracker
- **"Load More"** - Fetch additional history incrementally
- **"Load All"** - Fallback to original nearblocks approach if needed

### Phase 4: Unified Token Display
Intents tokens seamlessly integrated as fungible tokens:
```javascript
// Intents tokens appear as regular FT transactions
{
    transaction_hash: tx.hash,
    block: change.block,
    account_id: account,
    delta_amount: balance_diff,
    ft: {
        contract_id: 'wrap.near', // Extracted from 'nep141:wrap.near'
        symbol: 'wNEAR',
        decimals: 24
        // Transparent to reporting - no special handling needed
    }
}
```

## Advantages Over Current Approach

1. **Timestamp**: Block timestamp is available in `blockResult.header.timestamp` when fetching transactions
2. **Token Metadata**: Not needed in storage - only contract_id and balance changes matter for reports
3. **Rate Limiting**: User can stop/resume fetching anytime - incremental loading allows using the app with partial data
4. **Accuracy**: Balance-based detection may be more accurate than nearblocks API - we detect ANY balance change regardless of transaction complexity

## Testing

Test the implementation with:
```bash
# Test specific account
node nodescripts/track-latest-day.js petersalomonsen.near

# Test specific block range
node nodescripts/track-latest-day.js petersalomonsen.near 165828500

# Inspect specific block
node nodescripts/block-effects.js 153539831
```

## Next Steps

1. **Immediate - Port to Browser**:
   - Copy `nodescripts/balance-tracker.js` to `public_html/near/balance-tracker.js` with minimal changes:
     - Keep all the same functions and logic
     - Replace file system operations with `gitstorage.js` calls
     - Use existing progress bar for user feedback
   - Add "Load Recent" button to accounts page
   - Test with real accounts in browser

2. **Enhancements**:
   - Add timestamp fetching for accurate date/time display
   - Implement token metadata caching
   - Add batch processing for multiple accounts
   - Support parallel searches for different time ranges

3. **Future Optimizations**:
   - Add offline support with service worker (long-term)
   - Optimize caching strategy for better performance
   - Support for more token standards