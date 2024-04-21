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
</style>
<h3>Year report ( all accounts )</h3>


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

<table class="table table-sm table-hover">
    <thead class="table-dark">
        <th scope="col">
            date
        </th>
        <th scope="col">
            total balance
        </th>
        <th scope="col">
            change
        </th>
        <th scope="col">
            account balance
        </th>
        <th scope="col">
            change
        </th>
        <th scope="col">
            staking balance
        </th>
        <th scope="col">
            change
        </th>
        <th scope="col">
            reward
        </th>
        <th scope="col">
            ext received
        </th>
        <th scope="col">
            deposit
        </th>
        <th scope="col">
            withdrawals
        </th>
        <th scope="col">
            profit
        </th>
        <th scope="col">
            loss
        </th>
    </thead>
    <tbody id="dailybalancestable">

    </tbody>
    <tfoot class="table-dark">
        <th scope="col">

        </th>
        <th scope="col">

        </th>
        <th scope="col">

        </th>
        <th scope="col">

        </th>
        <th scope="col">

        </th>
        <th scope="col">

        </th>
        <th scope="col">

        </th>
        <th scope="col" class="numeric" id="totalreward">

        </th>
        <th scope="col" class="numeric" id="totalreceived">

        </th>
        <th scope="col" class="numeric" id="totaldeposit">

        </th>
        <th scope="col" class="numeric" id="totalwithdrawal">

        </th>
        <th scope="col" class="numeric" id="totalprofit">

        </th>
        <th scope="col" class="numeric" id="totalloss">

        </th>
        <th></th>
    </tfoot>
</table>

<h1>Transactions</h1>

<table class="table table-sm">
<thead>
    <tr>
    </tr>
</thead>
<tbody id="transactionstablebody">
</tbody>
</table>
`;