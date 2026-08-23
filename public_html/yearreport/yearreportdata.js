import { getAccounts, getTransactionsForAccount, getStakingRewardsForAccountAndPool, getAllFungibleTokenTransactionsByTxHash, getReceivedAccounts, getExpenseAccounts, getCustomRealizationRates } from "../storage/domainobjectstore.js";
import { getStakingAccounts } from "../near/stakingpool.js";
import { recomputeStakingEarnings } from "../near/accounting-export.js";
import { getEODPrice, getCustomSellPrice, getCustomBuyPrice } from '../pricedata/pricedata.js';
import { resolveDecimals } from '../near/intents-tokens.js';

const fungibleTokenData = {

};

/**
 * A balance observation rather than a movement: the accounting export writes
 * these with a synthetic `block-<height>` hash, which links nowhere on an
 * explorer, and pairs them with the real transaction for the same change.
 */
/**
 * How much each transaction moved, from the balances beside it.
 *
 * The rows arrive newest first, each carrying the balance that followed it, so
 * a movement is one row's balance minus the next one's. The catch is that the
 * accounting export writes the same movement twice — once as the real
 * transaction and once as a `block-<height>` balance observation — and both
 * rows carry the same balance. Subtracting between consecutive rows then puts
 * the whole change on whichever comes first, which is the observation, and
 * leaves the real transaction at zero, where it vanishes.
 *
 * On one real store that misdated a withdrawal by two days, split another into
 * two legs, and turned observations that reversed themselves a second later
 * into a run of movements that never happened.
 *
 * So the chain runs from one real transaction to the next and an observation
 * contributes nothing. The rows are left in place: `balance` is what the daily
 * balance columns read, and an observation is exactly the right thing to read a
 * balance off.
 */
export function deriveChangedBalances(transactions = []) {
    const nextRealBelow = new Array(transactions.length).fill(null);
    let candidate = null;
    for (let n = transactions.length - 1; n >= 0; n--) {
        nextRealBelow[n] = candidate;
        if (!isBalanceObservation(transactions[n])) candidate = n;
    }
    for (let n = 0; n < transactions.length; n++) {
        const tx = transactions[n];
        const older = nextRealBelow[n];
        tx.changedBalance = isBalanceObservation(tx) ? 0n : BigInt(tx.balance) - (
            older !== null ? BigInt(transactions[older].balance) : 0n
        );
    }
    return transactions;
}

export function isBalanceObservation(tx) {
    return typeof tx?.transaction_hash === 'string' && tx.transaction_hash.startsWith('block-');
}

export function getDecimalConversionValue(fungibleTokenSymbol) {
    return fungibleTokenSymbol ? fungibleTokenData[fungibleTokenSymbol]?.decimalConversionValue ?? Math.pow(10, -24) : Math.pow(10, -24);
}

export function getTokenSymbol(fungibleTokenContractId) {
    return fungibleTokenContractId ? fungibleTokenData[fungibleTokenContractId]?.symbol : 'NEAR';
}

export async function calculateYearReportData(fungibleTokenSymbol) {
    const accounts = await getAccounts();
    const accountsMap = accounts.reduce((obj, account) => {
        obj[account] = true;
        return obj;
    }, {});

    const accountTransactions = {};
    const transactionsByHash = {};
    const transactionsByDate = {};
    const allStakingAccounts = {};
    const receivedaccounts = await getReceivedAccounts();
    const expenseaccounts = await getExpenseAccounts();
    const customRealizationRates = await getCustomRealizationRates();

    let decimalConversionValue = Math.pow(10, -24);

    for (let account of accounts) {
        const transactions = (await getTransactionsForAccount(account, fungibleTokenSymbol)).filter(tx => tx.balance !== undefined);
        const fungbleTokenTxMap = await getAllFungibleTokenTransactionsByTxHash(account);

        if (fungibleTokenSymbol && transactions.length > 0) {
            const tx = transactions[0];
            // Always resolve correct decimals from cache/RPC (don't trust stored transaction data)
            // Guard against missing ft data (older transaction format)
            if (tx.ft?.contract_id) {
                const decimals = await resolveDecimals(tx.ft.contract_id, tx.ft.decimals);
                fungibleTokenData[tx.ft.contract_id] = { ...tx.ft, decimals };
                fungibleTokenData[tx.ft.contract_id].decimalConversionValue = Math.pow(10, -decimals);
                // Update local decimalConversionValue for use in the loop below
                decimalConversionValue = fungibleTokenData[tx.ft.contract_id].decimalConversionValue;
            }
        }
        deriveChangedBalances(transactions);

        for (let n = 0; n < transactions.length; n++) {
            const tx = transactions[n];
            tx.account = account;
            tx.visibleChangedBalance = Number(tx.changedBalance) * decimalConversionValue;
            // Classify incoming transfers from external accounts:
            // - Default: treat as deposit
            // - Exception: if sender is in receivedaccounts, treat as "received" (external income)
            // Both deposit and received enter FIFO cost basis at the same price.
            // The distinction is for reporting: received = income, deposit = not income.
            // Own accounts and staking pools are handled separately via hash grouping
            if (!accountsMap[tx.signer_id]
                && !allStakingAccounts[tx.signer_id]
                && tx.changedBalance > 0n
                && (receivedaccounts[tx.signer_id] || receivedaccounts[tx.involved_account_id])
                && (fungibleTokenSymbol || !fungbleTokenTxMap[tx.hash])
            ) {
                tx.receivedBalance = tx.changedBalance;
                // Remember which counterparty matched. The daily aggregate loses
                // it, and it is what decides whether this is income from outside
                // or yield on holdings already here — a distinction the FIFO
                // engine cannot make, since both arrive as lots at market value.
                tx.receivedFrom = receivedaccounts[tx.signer_id] ? tx.signer_id : tx.involved_account_id;
                tx.changedBalance = 0n;
            }

            // Classify outgoing transfers to expense accounts:
            // If receiver is in expenseaccounts and balance decreased, treat as expense (not withdrawal)
            // Expenses do not trigger FIFO realization — they are costs, not sales.
            if (!accountsMap[tx.receiver_id]
                && !allStakingAccounts[tx.receiver_id]
                && tx.changedBalance < 0n
                && (expenseaccounts[tx.receiver_id] || expenseaccounts[tx.involved_account_id])
                && (fungibleTokenSymbol || !fungbleTokenTxMap[tx.hash])
            ) {
                tx.expenseBalance = -tx.changedBalance;
                tx.changedBalance = 0n;
            }

            if (!transactionsByHash[tx.hash]) {
                transactionsByHash[tx.hash] = [];
            }
            transactionsByHash[tx.hash].push(tx);

            const datestring = new Date(tx.block_timestamp / 1_000_000).toJSON().substring(0, 'yyyy-MM-dd'.length);
            if (!transactionsByDate[datestring]) {
                transactionsByDate[datestring] = [];
            }
            transactionsByDate[datestring].unshift(tx);
        }

        const stakingAccounts = await getStakingAccounts(account);

        accountTransactions[account] = {
            arr: transactions,
            stakingAccounts: stakingAccounts,
            stakingBalances: {},
        };

        for (let stakingAccount of stakingAccounts) {
            allStakingAccounts[stakingAccount] = true;
            // Re-derive earnings from the balance series + principal moves so stored
            // data collected before the earnings fix (which booked deposits as
            // rewards) is corrected on read, without needing a re-import.
            const stakingRewards = recomputeStakingEarnings(
                await getStakingRewardsForAccountAndPool(account, stakingAccount, fungibleTokenSymbol));
            for (let stakingReward of stakingRewards) {
                const ts = stakingReward.timestamp.substr(0, 'yyyy-MM-dd'.length);
                const stakingBalances = accountTransactions[account].stakingBalances;
                if (!stakingBalances[ts]) {
                    stakingBalances[ts] = { totalStakingBalance: 0, totalEarnings: 0 };
                }
                if (stakingBalances[ts][stakingAccount] == undefined) {
                    stakingBalances[ts][stakingAccount] = stakingReward.balance;
                    stakingBalances[ts].totalStakingBalance += stakingReward.balance;
                }

                stakingBalances[ts].totalEarnings += stakingReward.earnings;
            }
        }
    }

    // Fill in gaps in staking balances - carry forward last known balance for each pool
    // This handles cases like unstaked-but-not-withdrawn funds where the API has no
    // snapshots for days between unstake and withdraw
    for (let account of accounts) {
        const stakingBalances = accountTransactions[account].stakingBalances;
        const stakingAccounts = accountTransactions[account].stakingAccounts;

        // Get all dates that have any staking data, sorted
        const dates = Object.keys(stakingBalances).sort();

        // Track last known balance for each pool
        const lastKnownBalance = {};

        for (const date of dates) {
            for (const pool of stakingAccounts) {
                if (stakingBalances[date][pool] !== undefined) {
                    // Update last known balance
                    lastKnownBalance[pool] = stakingBalances[date][pool];
                } else if (lastKnownBalance[pool] !== undefined && lastKnownBalance[pool] > 0) {
                    // Carry forward last known balance (pool has no entry for this day)
                    stakingBalances[date][pool] = lastKnownBalance[pool];
                    stakingBalances[date].totalStakingBalance += lastKnownBalance[pool];
                }
            }
        }
    }

    const dailyBalances = {};
    let prevDateString;
    // Last staking balance seen per account, so a gap in the source data does
    // not read as an unstaking.
    const lastStakingBalance = {};
    let currentDate = new Date(2020, 0, 1);
    const endDate = new Date();
    const accountDailyBalances = {};
    while (currentDate.getTime() < endDate) {
        const datestring = currentDate.toJSON().substring(0, 'yyyy-MM-dd'.length);
        dailyBalances[datestring] = {
            totalBalance: 0,
            accountBalance: 0,
            stakingBalance: 0,
            stakingEarnings: 0,
            deposit: 0,
            withdrawal: 0,
            received: 0n,
            receivedFrom: [],
            expense: 0n,
            // Per-transaction detail behind `deposit` and `withdrawal`. The
            // aggregate cannot tell a swap from money crossing the portfolio
            // boundary: a swap shows up as a withdrawal in one token's pass and
            // a deposit in another's, and the only thing tying those two legs
            // together is the hash. See portfolio/flow-decomposition.js.
            flows: []
        };
        currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 1);
        accounts.forEach(account => {
            const transactionsObj = accountTransactions[account];
            const todaysStaking = transactionsObj.stakingBalances[datestring];
            if (todaysStaking) {
                lastStakingBalance[account] = todaysStaking.totalStakingBalance;
                dailyBalances[datestring].stakingBalance += todaysStaking.totalStakingBalance;
                dailyBalances[datestring].stakingEarnings += todaysStaking.totalEarnings;
            } else if (lastStakingBalance[account] != null) {
                // Carry the last known balance forward for as long as the series
                // is missing, not for a single day. A one-day carry-forward looks
                // right until the source data lags by two: the staked balance
                // then reads as zero, which is not a fact about the account but
                // about what has been fetched. It reached the portfolio as a
                // staked position with no cost basis, and an unrealized loss of
                // the whole position's basis reported against what was left
                // liquid. A balance does not disappear because nobody asked.
                dailyBalances[datestring].stakingBalance += lastStakingBalance[account];
            }
        });
        if (transactionsByDate[datestring]) {
            transactionsByDate[datestring].forEach(tx => {
                let changedBalanceForHashAllAccounts = BigInt(0);
                // Who was on the other side. A movement to one of the portfolio's
                // own venues — the intents contract, a confidential address — is
                // not money leaving, and the hash alone cannot say so: the two
                // sides of a bucket transfer are two different transactions.
                const counterparties = new Set();
                const allTxEntriesForHash = transactionsByHash[tx.hash];
                allTxEntriesForHash.forEach(tx => {
                    for (const candidate of [tx.involved_account_id, tx.signer_id, tx.receiver_id]) {
                        if (candidate && !accountsMap[candidate]) counterparties.add(candidate);
                    }
                    changedBalanceForHashAllAccounts += tx.changedBalance;
                    tx.changedBalance = 0n;
                    if (tx.receivedBalance) {
                        dailyBalances[datestring].received += tx.receivedBalance;
                        dailyBalances[datestring].receivedFrom.push({
                            account: tx.receivedFrom,
                            amount: Number(tx.receivedBalance)
                        });
                        tx.receivedBalance = 0n;
                    }
                    if (tx.expenseBalance) {
                        dailyBalances[datestring].expense += tx.expenseBalance;
                        tx.expenseBalance = 0n;
                    }
                });

                if (!allStakingAccounts[tx.signer_id] && !allStakingAccounts[tx.receiver_id]) {
                    if (changedBalanceForHashAllAccounts !== BigInt(0)) {
                        dailyBalances[datestring].flows.push({
                            hash: tx.hash,
                            changed: Number(changedBalanceForHashAllAccounts),
                            counterparties: [...counterparties],
                            // When it happened. Two sides of one swap settle
                            // seconds apart even when they are two transactions.
                            at: tx.block_timestamp
                        });
                    }
                    if (changedBalanceForHashAllAccounts >= BigInt(0)) {
                        dailyBalances[datestring].deposit += Number(changedBalanceForHashAllAccounts);
                    } else {
                        dailyBalances[datestring].withdrawal += -Number(changedBalanceForHashAllAccounts);
                        if (customRealizationRates[tx.hash]) {
                            const customRealization = customRealizationRates[tx.hash];
                            if (!dailyBalances[datestring].customRealizationRates) {
                                dailyBalances[datestring].customRealizationRates = [];
                            }
                            dailyBalances[datestring].customRealizationRates.push({
                                currency: customRealization.realizationCurrency,
                                dateTime: customRealization.realizationTime,
                                amount: -changedBalanceForHashAllAccounts,
                                price: customRealization.realizationPrice
                            });
                        }
                    }
                }
                accountDailyBalances[tx.account] = BigInt(tx.balance);
            });
        }
        dailyBalances[datestring].accountBalance = Object.values(accountDailyBalances).reduce((p, c) => p + c, BigInt(0));
        dailyBalances[datestring].totalBalance = dailyBalances[datestring].stakingBalance + Number(dailyBalances[datestring].accountBalance);
        dailyBalances[datestring].accounts = Object.assign({}, accountDailyBalances);
        if (prevDateString) {
            const totalChange = dailyBalances[datestring].totalBalance - dailyBalances[prevDateString].totalBalance;
            const accountChange = dailyBalances[datestring].accountBalance - dailyBalances[prevDateString].accountBalance;
            const stakingChange = dailyBalances[datestring].stakingBalance - dailyBalances[prevDateString].stakingBalance;
            const stakingRewards = dailyBalances[datestring].stakingEarnings;

            Object.assign(
                dailyBalances[datestring],
                {
                    totalChange: totalChange,
                    accountChange: accountChange,
                    stakingChange: stakingChange,
                    stakingRewards: stakingRewards
                });
        }
        prevDateString = datestring;
    }

    return { dailyBalances, transactionsByDate, accounts };
}

export async function calculateProfitLoss(dailyBalances, targetCurrency, token) {
    if (!targetCurrency) {
        return { dailyBalances };
    }
    const openPositions = [];
    const closedPositions = [];
    const decimalConversionValue = getDecimalConversionValue(token);

    for (const datestring in dailyBalances) {
        const dailyEntry = dailyBalances[datestring];
        dailyEntry.convertToCurrencyWithdrawalAmount = 0;

        let dayProfit = 0;
        let dayLoss = 0;
        if (dailyEntry.received > 0n || dailyEntry.deposit > 0 || dailyEntry.reward > 0) {
            const amount = Number(dailyEntry.received ?? 0n) + dailyEntry.deposit ?? 0 + dailyEntry.reward ?? 0;
            const conversionRate = await getEODPrice(targetCurrency, datestring, token);
            openPositions.push({
                date: datestring,
                initialAmount: amount,
                remainingAmount: amount,
                convertedValue: conversionRate * amount * decimalConversionValue,
                conversionRate: conversionRate,
                realizations: []
            });
        }

        if (dailyEntry.withdrawal > 0) {
            dailyEntry.realizations = [];

            const createRealizationsForWithdrawal = (withdrawalAmount, conversionRate) => {
                let dayRealizedAmount = 0;
                dailyEntry.convertToCurrencyWithdrawalAmount += withdrawalAmount * conversionRate * decimalConversionValue;

                while (openPositions.length > 0 && dayRealizedAmount < withdrawalAmount) {
                    const position = openPositions[0];
                    if ((dayRealizedAmount + position.remainingAmount) > withdrawalAmount) {
                        const partlyRealizedPositionAmount = (withdrawalAmount - dayRealizedAmount);
                        const partlyRealizedPositionInitialConvertedValue = position.convertedValue * (partlyRealizedPositionAmount / position.initialAmount);
                        const partlyRealizedPositionRealizedConvertedValue = partlyRealizedPositionAmount * decimalConversionValue * conversionRate;
                        position.remainingAmount -= partlyRealizedPositionAmount;
                        dayRealizedAmount = withdrawalAmount;

                        const profitLoss = partlyRealizedPositionRealizedConvertedValue - partlyRealizedPositionInitialConvertedValue;
                        if (profitLoss >= 0) {
                            dayProfit += profitLoss;
                        } else {
                            dayLoss += -profitLoss;
                        }
                        const realizationEntry = {
                            date: datestring,
                            amount: partlyRealizedPositionAmount,
                            initialConvertedValue: partlyRealizedPositionInitialConvertedValue,
                            convertedValue: partlyRealizedPositionRealizedConvertedValue,
                            profit: profitLoss >= 0 ? profitLoss : 0,
                            conversionRate: conversionRate,
                            loss: profitLoss < 0 ? -profitLoss : 0,
                        };
                        position.realizations.push(realizationEntry);
                        dailyEntry.realizations.push(
                            Object.assign({}, realizationEntry, {
                                position: Object.assign({}, position, { realizations: undefined })
                            })
                        );
                    } else {
                        dayRealizedAmount += position.remainingAmount;

                        const convertedValue = conversionRate * position.remainingAmount * decimalConversionValue;
                        const initialConvertedValue = position.convertedValue * (position.remainingAmount / position.initialAmount);
                        const profitLoss = convertedValue - initialConvertedValue;
                        if (profitLoss >= 0) {
                            dayProfit += profitLoss;
                        } else {
                            dayLoss += -profitLoss;
                        }
                        const realizationEntry = {
                            date: datestring,
                            amount: position.remainingAmount,
                            convertedValue: convertedValue,
                            initialConvertedValue,
                            conversionRate: conversionRate,
                            profit: profitLoss >= 0 ? profitLoss : 0,
                            loss: profitLoss < 0 ? -profitLoss : 0,
                        };
                        position.realizations.push(realizationEntry);
                        dailyEntry.realizations.push(
                            Object.assign({}, realizationEntry, {
                                position: Object.assign({}, position, { realizations: undefined })
                            })
                        );
                        position.remainingAmount = 0;
                        closedPositions.push(position);
                        openPositions.shift();
                    }
                }
                // Tolerate float64 rounding: summing large raw (yocto) position
                // amounts loses ~1e-16 relative precision, so dayRealizedAmount can
                // fall a few units short of withdrawalAmount even when they're the
                // same position set. Only a shortfall beyond that noise floor is a
                // real bug worth reporting (a genuine one is on the order of whole
                // tokens, i.e. >>1e-9 relative).
                if (withdrawalAmount - dayRealizedAmount > withdrawalAmount * 1e-9) {
                    console.error(`should not happen: withdrawn amount larger than available positions. wanted to withdraw: ${withdrawalAmount}, available: ${dayRealizedAmount}`);
                }
            };

            const conversionRate = await getCustomSellPrice(targetCurrency, datestring, token);

            let remainingWithdrawal = dailyEntry.withdrawal;
            if (dailyEntry.customRealizationRates) {
                for (const customRealizationRate of dailyEntry.customRealizationRates) {
                    if (remainingWithdrawal < Number(customRealizationRate.amount)) {
                        console.error('custom realization with higher amount than withdrawal for day', customRealizationRate);
                    }
                    if (targetCurrency === customRealizationRate.currency) {
                        remainingWithdrawal -= Number(customRealizationRate.amount);
                        createRealizationsForWithdrawal(Number(customRealizationRate.amount), customRealizationRate.price);
                    }
                }
            }
            if (remainingWithdrawal > 0) {
                createRealizationsForWithdrawal(remainingWithdrawal, conversionRate);
            }

            dailyEntry.profit = dayProfit;
            dailyEntry.loss = dayLoss;
        }
    }
    return { openPositions, closedPositions, dailyBalances };
}

export async function getConvertedValuesForDay(rowdata, convertToCurrency, datestring) {
    const convertToCurrencyIsNEAR = !convertToCurrency || convertToCurrency === 'near';
    const conversionRate = convertToCurrencyIsNEAR ? 1 : await getEODPrice(convertToCurrency, datestring);

    const stakingReward = (conversionRate * (rowdata.stakingRewards / 1e+24));
    const received = (conversionRate * (Number(rowdata.received) / 1e+24));
    const depositConversionRate = convertToCurrencyIsNEAR ? 1 : await getCustomBuyPrice(convertToCurrency, datestring);
    const deposit = (depositConversionRate * (rowdata.deposit / 1e+24));
    const withdrawal = convertToCurrencyIsNEAR ? (rowdata.withdrawal / 1e+24)  : rowdata.convertToCurrencyWithdrawalAmount;
    const expense = (conversionRate * (Number(rowdata.expense) / 1e+24));

    return { stakingReward, received, deposit, withdrawal, expense, conversionRate };
}

export async function getFungibleTokenConvertedValuesForDay(rowdata, symbol, convertToCurrency, datestring) {
    const doNotConvert = convertToCurrency ? false : true;
    const conversionRate = doNotConvert ? 1 : await getEODPrice(convertToCurrency, datestring, symbol);

    const decimalConversionValue = fungibleTokenData[symbol]?.decimalConversionValue ?? Math.pow(10, -24);
    const received = (conversionRate * (Number(rowdata.received) * decimalConversionValue));
    const stakingReward = (conversionRate * (rowdata.stakingRewards * decimalConversionValue));
    const deposit = (conversionRate * (rowdata.deposit * decimalConversionValue));
    const withdrawal = (conversionRate * (rowdata.withdrawal * decimalConversionValue));
    const expense = (conversionRate * (Number(rowdata.expense) * decimalConversionValue));

    return { stakingReward, received, deposit, withdrawal, expense, conversionRate };
}