export default /*html*/ `
<style>
    .numeric {
        text-align: right;
    }
    .pagebreak {
        page-break-after: always;
    }
</style>
<h1>Year report <span id="yearspan"></span></h1>

<p>This report is for activity in the following accounts: <span style="font-style: italic;" id="accountsspan"></span></p>

<p>The following table shows the outbound balance, earnings, and profit/loss on realizations per fungible token.</p>

<template id="symmaryrowtemplate">
    <tr>
        <td class="summary_token"></td>
        <td class="summary_balance numeric"></td>
        <td class="summary_earnings numeric"></td>
        <td class="summary_profit numeric"></td>
        <td class="summary_loss numeric"></td>
    </tr>
</template>
<table class="table">
<thead>
    <tr>
        <th scope="col">
            token
        </th>
        <th scope="col" class="numeric">
            balance
        </th>
        <th scope="col" class="numeric">
            earnings
        </th>
        <th scope="col" class="numeric profit">
            profit
        </th>
        <th scope="col" class="numeric loss">
            loss
        </th>
    </tr>
</thead>
<tbody id="summarytablebody">
</tbody>
<tfoot id="summarytablefooter">
    <tr>
        <th>Total</th>
        <th id="summary_total_balance" class="numeric"></th>
        <th id="summary_total_earnings" class="numeric"></th>
        <th id="summary_total_profit" class="numeric profit"></th>
        <th id="summary_total_loss" class="numeric loss"></th>
    </tr>
</tfoot>
</table>

<p>In the following pages there are detailed reports for each fungible token.</p>

<div id="tokenyearreports"></div>
`;