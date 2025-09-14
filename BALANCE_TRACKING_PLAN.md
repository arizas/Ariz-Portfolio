# Balance-Based Transaction Discovery Plan

## Overview
Use daily balance snapshots to efficiently discover when transactions occurred, then fetch only those specific transactions to maintain the existing transaction-based storage structure. Support fetching data for specific timeframes instead of entire account history.

## Goal
- **Keep existing storage structure**: Transaction records with balance
- **Keep existing report logic**: No changes to presentation layer
- **Improve discovery**: Use balance changes to find transactions efficiently
- **Enable timeframe-specific loading**: Fetch data for custom date ranges (e.g., last month, last year, specific dates)

## Current State
- System fetches ALL transactions for accounts
- Stores transactions with balance after each transaction
- Report logic depends on this transaction structure

## Proposed Approach
Use balance tracking to discover WHEN transactions happened, then fetch ONLY those specific transactions.

## Implementation Steps

### Phase 1: Balance Change Detection System

#### 1.1 Daily Balance Checker
- **File**: `public_html/near/balance-tracker.js`
- **Core Functions**:
  ```javascript
  // Get account balance at specific date/block
  async function getAccountBalanceAtBlock(account_id, block_id)
  
  // Get all token balances including NEAR, FTs, and intents.near
  async function getAllBalances(account_id, block_id) {
    return {
      near: await getAccountBalance(account_id, block_id),
      fungibleTokens: await getFungibleTokenBalances(account_id, block_id),
      intents: await getIntentsBalances(account_id, block_id)
    };
  }
  
  // Compare two balance snapshots
  function detectBalanceChanges(balance1, balance2) {
    return {
      nearChanged: balance1.near !== balance2.near,
      tokensChanged: {...},
      intentsChanged: {...}
    };
  }
  ```

#### 1.2 Change Detection Algorithm
```javascript
async function findTransactionDates(account_id, startDate, endDate) {
  const transactionDates = [];
  
  for (let date = startDate; date <= endDate; date = nextDay(date)) {
    const startBalance = await getAllBalances(account_id, startOfDay(date));
    const endBalance = await getAllBalances(account_id, endOfDay(date));
    
    const changes = detectBalanceChanges(startBalance, endBalance);
    if (hasAnyChange(changes)) {
      transactionDates.push({
        date,
        changes,
        startBlock: startOfDay(date),
        endBlock: endOfDay(date)
      });
    }
  }
  
  return transactionDates;
}
```

### Phase 2: Transaction Discovery

#### 2.1 Binary Search for Exact Transaction Block
```javascript
async function findTransactionBlocks(account_id, startBlock, endBlock, balanceType) {
  const transactions = [];
  
  // Binary search to find exact blocks where balance changed
  async function binarySearch(start, end) {
    if (end - start <= 1) return [end];
    
    const mid = Math.floor((start + end) / 2);
    const midBalance = await getBalance(account_id, mid, balanceType);
    const startBalance = await getBalance(account_id, start, balanceType);
    
    if (midBalance !== startBalance) {
      // Change in first half
      return binarySearch(start, mid);
    } else {
      // Change in second half
      return binarySearch(mid, end);
    }
  }
  
  return await binarySearch(startBlock, endBlock);
}
```

#### 2.2 Fetch Specific Transactions
Two approaches depending on the type of balance change:

**Option A: Use NearBlocks for known transaction types (when available)**
- If balance change is detected in a day, first try NearBlocks API
- NearBlocks can provide all regular NEAR and FT transactions for that day
- No binary search needed for these transaction types

**Option B: Binary search for transactions not in NearBlocks**
- For NEAR Intents transactions (not currently in NearBlocks)
- For any balance changes not explained by NearBlocks data
- Use binary search to find exact block, then RPC to get transaction

```javascript
async function fetchTransactionsForDay(account_id, date, balanceChanges) {
  const transactions = [];
  
  // 1. Try NearBlocks first for regular transactions
  if (balanceChanges.nearChanged || balanceChanges.tokensChanged) {
    try {
      const nearBlocksTxs = await fetchFromNearBlocks(account_id, date);
      transactions.push(...nearBlocksTxs);
      
      // Check if NearBlocks explains all balance changes
      const explainedChanges = calculateChangesFromTransactions(nearBlocksTxs);
      balanceChanges = removeExplainedChanges(balanceChanges, explainedChanges);
    } catch (e) {
      // NearBlocks unavailable, will use binary search for everything
    }
  }
  
  // 2. Binary search for remaining unexplained changes (e.g., intents.near)
  if (balanceChanges.intentsChanged || hasUnexplainedChanges(balanceChanges)) {
    const blocks = await findTransactionBlocks(
      account_id,
      startOfDay(date),
      endOfDay(date),
      balanceChanges
    );
    
    for (const block of blocks) {
      const tx = await fetchTransactionFromRPC(account_id, block);
      transactions.push(tx);
    }
  }
  
  return transactions;
}
```

### Phase 3: Fungible Token Discovery

#### 3.1 Valuable Token Detection
```javascript
async function discoverValuableTokens(account_id) {
  const tokens = new Set();
  
  // 1. Check popular tokens
  const popularTokens = [
    'usdt.tether-token.near',
    'usdc.portalbridge.near', 
    'wrap.near',
    // ... more tokens
  ];
  
  for (const token of popularTokens) {
    const balance = await getTokenBalance(account_id, token);
    if (balance > 0) {
      const value = await getTokenValue(token, balance);
      if (value > 1) { // $1 threshold
        tokens.add(token);
      }
    }
  }
  
  // 2. Check intents.near for token positions
  const intentsTokens = await getIntentsTokens(account_id);
  tokens.add(...intentsTokens);
  
  return Array.from(tokens);
}
```

### Phase 4: NEAR Intents Integration

#### 4.1 Intents Balance Tracking
```javascript
async function getIntentsBalances(account_id, block_id) {
  // Query intents.near contract
  const intents = await viewAccount(block_id, 'intents.near', {
    method: 'get_account_intents',
    args: { account_id }
  });
  
  return intents.map(intent => ({
    token: intent.token_id,
    amount: intent.amount,
    expiry: intent.expiry,
    // Include in balance calculations
  }));
}
```

### Phase 5: Integration with Existing Code

#### 5.1 Add Timeframe Selection UI
```javascript
// In accounts-page.component.js
// Add date range selector to UI
<div class="timeframe-selector">
  <select id="timeframe">
    <option value="7d">Last 7 days</option>
    <option value="30d">Last 30 days</option>
    <option value="90d">Last 90 days</option>
    <option value="1y">Last year</option>
    <option value="ytd">Year to date</option>
    <option value="custom">Custom range</option>
  </select>
  <input type="date" id="startDate" />
  <input type="date" id="endDate" />
</div>
```

#### 5.2 Update Load Data Function with Timeframe Support
```javascript
// In accounts-page.component.js
async function loadDataForTimeframe(account, startDate, endDate) {
  setProgressbarValue(0, `Loading data from ${startDate} to ${endDate}`);
  
  // 1. Get initial balance at start date
  const initialBalance = await getAccountBalanceAtBlock(
    account, 
    getBlockAtDate(startDate)
  );
  
  setProgressbarValue(10, 'Discovering transactions...');
  
  // 2. Discover which days have transactions IN THIS TIMEFRAME
  const daysWithChanges = await findTransactionDates(
    account, 
    startDate,  // User-specified start
    endDate     // User-specified end
  );
  
  setProgressbarValue(20, 'Finding valuable tokens...');
  
  // 3. Discover valuable tokens (only check current state, much faster)
  const valuableTokens = await discoverValuableTokens(account);
  
  setProgressbarValue(40, 'Fetching transactions...');
  
  // 4. For each day with changes, find and fetch transactions
  const transactions = [];
  for (let i = 0; i < daysWithChanges.length; i++) {
    const dayInfo = daysWithChanges[i];
    setProgressbarValue(40 + (40 * i / daysWithChanges.length), 
      `Processing ${dayInfo.date}`);
    
    // Try NearBlocks first, then binary search if needed
    const dayTxs = await fetchTransactionsForDay(
      account,
      dayInfo.date,
      dayInfo.changes
    );
    transactions.push(...dayTxs);
  }
  
  setProgressbarValue(80, 'Calculating balances...');
  
  // 5. Calculate balance after each transaction
  let currentBalance = initialBalance;
  for (const tx of transactions) {
    tx.balance = await getAccountBalanceAfterTransaction(
      account, 
      tx.hash
    );
    currentBalance = tx.balance;
  }
  
  setProgressbarValue(100, 'Complete');
  
  // 6. Store in existing format with metadata
  return {
    transactions,
    timeframe: { startDate, endDate },
    initialBalance,
    finalBalance: currentBalance
  };
}

// Incremental loading for longer timeframes
async function loadDataIncrementally(account, startDate, endDate) {
  const chunks = splitIntoMonthlyChunks(startDate, endDate);
  const allTransactions = [];
  
  for (const chunk of chunks) {
    const data = await loadDataForTimeframe(
      account, 
      chunk.start, 
      chunk.end
    );
    allTransactions.push(...data.transactions);
    
    // Store/display partial results as they load
    updateUIWithPartialData(allTransactions);
  }
  
  return allTransactions;
}
```

#### 5.2 Maintain Existing Storage
The function returns transactions in the exact same format:
```javascript
{
  hash: "...",
  block_height: 123456,
  timestamp: "...",
  signer_id: "...",
  receiver_id: "...",
  action_kind: "...",
  args: {},
  balance: "1234.56789", // Balance after transaction
  // ... other existing fields
}
```

### Phase 6: Optimization Strategies

#### 6.1 Caching
- Cache daily balance snapshots
- Cache token discovery results
- Cache block height mappings for dates

#### 6.2 Parallel Processing
```javascript
// Fetch multiple balance checks in parallel
const balanceChecks = dates.map(date => 
  getAllBalances(account, date)
);
const results = await Promise.all(balanceChecks);
```

#### 6.3 Smart Transaction Fetching Strategy
Use the most efficient method based on transaction type:
```javascript
async function smartTransactionFetch(account_id, date, balanceChanges) {
  // Strategy:
  // 1. NearBlocks for regular NEAR/FT transactions (bulk fetch for entire day)
  // 2. Binary search + RPC for intents.near and unexplained changes
  
  const strategy = {
    useNearBlocks: balanceChanges.nearChanged || balanceChanges.tokensChanged,
    useBinarySearch: balanceChanges.intentsChanged || false,
    fallbackToBinarySearch: false
  };
  
  // This hybrid approach minimizes API calls:
  // - One NearBlocks call can get all regular transactions for a day
  // - Binary search only used when necessary (intents, missing data)
  // - RPC used for specific block fetches after binary search
  
  return executeStrategy(strategy, account_id, date);
}
```

## Benefits

1. **Massive Performance Improvement**
   - Only fetch transactions that actually exist
   - Skip days/blocks with no activity
   - Binary search minimizes RPC calls

2. **Maintains Compatibility**
   - Same storage structure
   - Same transaction format
   - No changes to report logic

3. **Better Coverage**
   - Discovers all valuable tokens
   - Includes NEAR Intents
   - Doesn't miss any balance changes

## Implementation Priority

1. **Start with NEAR balance changes** (simplest)
2. **Add popular fungible tokens** (USDT, USDC, wNEAR)
3. **Add intents.near support**
4. **Add comprehensive token discovery**

## Migration Strategy

1. Add feature flag: `useBalanceDiscovery: true/false`
2. Run both methods in parallel for testing
3. Compare results to ensure accuracy
4. Gradually enable for all users

## Estimated Performance Gains

| Scenario | Current (All Txs) | New (Balance-Based) | Improvement |
|----------|------------------|---------------------|-------------|
| Account with 10K txs over 1 year | 10,000 RPC calls | ~365 + ~50 calls | 95% reduction |
| Account with daily activity | 365+ RPC calls | ~365 + ~365 calls | ~50% reduction |
| Inactive account | Many RPC calls | ~365 calls | Depends on history |

## Next Steps

1. Implement Phase 1: Balance change detection
2. Test with sample accounts
3. Implement Phase 2: Binary search for transactions
4. Integrate with existing transaction storage
5. Add token and intents support