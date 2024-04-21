export default /*html*/ `<style>
    .numeric {
        text-align: right;
    }

    .dailybalancerow_datetime {
        white-space: nowrap;
    }

    .dailybalancerow_balance {
        white-space: nowrap;
    }

    tr.inforow td {
        font-size: 12px;   
    }

    #transactionstablebody td:nth-child(2) {
        max-width: 300px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    #transactionstablebody td:nth-child(3) {
        max-width: 300px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .pagebreak {
        page-break-after: always;
    }
</style>
<h1><span id="tokenspan"></span> <span id="currencyspan"></span> <span id="yearspan"></span></h1>

<table class="table">
<tr>
    <td>Staking rewards</td>
    <td class="numeric" id="totalreward"></td>
</tr>
<tr>
    <td>Received (Earnings)</td>
    <td class="numeric" id="totalreceived"></td>
</tr>
<tr>
    <td>Deposit</td>
    <td class="numeric" id="totaldeposit"></td>
</tr>
<tr>
    <td>Withdrawal</td>
    <td class="numeric" id="totalwithdrawal"></td>
</tr>
<tr>
    <td>Profit on realizations</td>
    <td class="numeric" id="totalprofit"></td>
</tr>
<tr>
    <td>Loss on realizations</td>
    <td class="numeric" id="totalloss"></td>
</tr>
<tr>
    <td>Accounts</td>
    <td id="accountscolumn"></td>
</tr>
</table>
        
<template id="dailybalancerowtemplate">
    <tr>
        <td class="dailybalancerow_datetime"></td>
        <td class="dailybalancerow_totalbalance numeric"></td>
        <td class="dailybalancerow_change numeric"></td>
        <td class="dailybalancerow_accountbalance numeric"></td>
        <td class="dailybalancerow_accountchange numeric"></td>
        <td class="dailybalancerow_stakingbalance numeric"></td>
        <td class="dailybalancerow_stakingchange numeric"></td>
        <td class="dailybalancerow_stakingreward numeric"></td>
        <td class="dailybalancerow_received numeric"></td>
        <td class="dailybalancerow_deposit numeric"></td>
        <td class="dailybalancerow_withdrawal numeric"></td>
        <td class="dailybalancerow_profit numeric"></td>
        <td class="dailybalancerow_loss numeric"></td>
    </tr>
    <tr class="inforow bg-info">
        <td colspan="13" >
            <table class="table table-sm table-borderless">
                <thead>
                    <tr>
                        <th scope="col">acquisition date</th>
                        <th scope="col">acquired amount</th>
                        <th scope="col">acquisition price</th>
                        <th scope="col">realized amount</th>
                        <th scope="col">realization price</th>
                    </tr>
                </thead>
                <tbody></tbody>
            </table>
        </td>
    </tr>
</template>

<div class="pagebreak"></div>

<h1>Daily changes</h1>
<p>
The following table shows the first and last day of the year, and each day where there are changes in the balance.
Any transfer to other accounts than those reported for, are counted as withdrawals.
If there are withdrawals, then profit or loss of the realizations relative to the target currency are calculated, and displayed as a table under
the row for that day. Staking rewards are added without any transaction taking place, and the new staking balance
is obtained by calling the staking contract for the balance for that specific date.
</p>
<table class="table table-sm table-hover">
    <thead class="table-dark">
        <th scope="col">
            date
        </th>
        <th scope="col" class="numeric">
            total balance
        </th>
        <th scope="col" class="numeric">
            change
        </th>
        <th scope="col" class="numeric">
            account balance
        </th>
        <th scope="col" class="numeric">
            change
        </th>
        <th scope="col" class="numeric">
            staking balance
        </th>
        <th scope="col" class="numeric">
            change
        </th>
        <th scope="col" class="numeric">
            reward
        </th>
        <th scope="col" class="numeric">
            ext received
        </th>
        <th scope="col" class="numeric">
            deposit
        </th>
        <th scope="col" class="numeric">
            withdrawals
        </th>
        <th scope="col" class="numeric">
            profit
        </th>
        <th scope="col" class="numeric">
            loss
        </th>
    </thead>
    <tbody id="dailybalancestable">

    </tbody>
</table>

<div class="pagebreak"></div>

<h1>Transactions</h1>
<p>
Below are all the transactions recorded for the accounts. Transactions may be because of function calls to
smart contracts, transfers, adding access keys and more. The balance change is calculated by querying the account
for the balance before and after the transaction. The balance changes are viewed as token amounts, and not converted
to the currency used above. Note that for each row there is a link to <a href="https://nearblocks.io">nearblocks.io</a> for
more details about the transaction.
</p>
<table class="table table-sm">
<thead>
    <tr>
        <th>Date</th>
        <th>Signer</th>
        <th>Receiver</th>
        <th>Type</th>
        <th class="numeric">Changed balance</th>
        <th></th>
    </tr>
</thead>
<tbody id="transactionstablebody">
</tbody>
</table>
`;