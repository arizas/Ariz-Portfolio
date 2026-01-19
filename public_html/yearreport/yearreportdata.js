import { getAccounts, getTransactionsForAccount, getStakingRewardsForAccountAndPool, getAllFungibleTokenTransactionsByTxHash, getDepositAccounts, getCustomRealizationRates } from "../storage/domainobjectstore.js";
import { getStakingAccounts } from "../near/stakingpool.js";
import { getEODPrice, getCustomSellPrice, getCustomBuyPrice } from '../pricedata/pricedata.js';
import { resolveDecimals } from '../near/intents-tokens.js';

const fungibleTokenData = {

};

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
    const depositaccounts = await getDepositAccounts();
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
        for (let n = 0; n < transactions.length; n++) {
            const tx = transactions[n];
            tx.account = account;
            tx.changedBalance = BigInt(tx.balance) - (
                n < transactions.length - 1 ? BigInt(transactions[n + 1].balance) : 0n
            );

            tx.visibleChangedBalance = Number(tx.changedBalance) * decimalConversionValue;
            if (!accountsMap[tx.signer_id]
                && !allStakingAccounts[tx.signer_id]
                && tx.changedBalance > 0n
                && !depositaccounts[tx.signer_id]
                && !depositaccounts[tx.involved_account_id]
                && (fungibleTokenSymbol || !fungbleTokenTxMap[tx.hash])
            ) {
                tx.receivedBalance = tx.changedBalance;
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
            const stakingRewards = await getStakingRewardsForAccountAndPool(account, stakingAccount, fungibleTokenSymbol);
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

    const dailyBalances = {};
    let prevDateString;
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
            received: 0n
        };
        currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 1);
        accounts.forEach(account => {
            const transactionsObj = accountTransactions[account];
            if (transactionsObj.stakingBalances[datestring]) {
                dailyBalances[datestring].stakingBalance += transactionsObj.stakingBalances[datestring].totalStakingBalance;
                dailyBalances[datestring].stakingEarnings += transactionsObj.stakingBalances[datestring].totalEarnings;
            } else if (prevDateString && transactionsObj.stakingBalances[prevDateString]) {
                dailyBalances[datestring].stakingBalance += transactionsObj.stakingBalances[prevDateString].totalStakingBalance;
            }
        });
        if (transactionsByDate[datestring]) {
            transactionsByDate[datestring].forEach(tx => {
                let changedBalanceForHashAllAccounts = BigInt(0);
                const allTxEntriesForHash = transactionsByHash[tx.hash];
                allTxEntriesForHash.forEach(tx => {
                    changedBalanceForHashAllAccounts += tx.changedBalance;
                    tx.changedBalance = 0n;
                    if (tx.receivedBalance) {
                        dailyBalances[datestring].received += tx.receivedBalance;
                        tx.receivedBalance = 0n;
                    }
                });

                if (!allStakingAccounts[tx.signer_id] && !allStakingAccounts[tx.receiver_id]) {
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
                if (dayRealizedAmount < withdrawalAmount) {
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

    return { stakingReward, received, deposit, withdrawal, conversionRate };
}

export async function getFungibleTokenConvertedValuesForDay(rowdata, symbol, convertToCurrency, datestring) {
    const doNotConvert = convertToCurrency ? false : true;
    const conversionRate = doNotConvert ? 1 : await getEODPrice(convertToCurrency, datestring, symbol);

    const decimalConversionValue = fungibleTokenData[symbol]?.decimalConversionValue ?? Math.pow(10, -24);
    const received = (conversionRate * (Number(rowdata.received) * decimalConversionValue));
    const stakingReward = (conversionRate * (rowdata.stakingRewards * decimalConversionValue));
    const deposit = (conversionRate * (rowdata.deposit * decimalConversionValue));
    const withdrawal = (conversionRate * (rowdata.withdrawal * decimalConversionValue));

    return { stakingReward, received, deposit, withdrawal, conversionRate };
}