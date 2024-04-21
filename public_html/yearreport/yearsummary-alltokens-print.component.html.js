export default /*html*/ `
<style>
    .numeric {
        text-align: right;
    }
    .pagebreak {
        page-break-after: always;
    }
</style>
<h1>Year report</h1>

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
        <th scope="col" class="numeric">
            profit
        </th>
        <th scope="col" class="numeric">
            loss
        </th>
    </tr>
</thead>
<tbody id="summarytablebody">
</tbody>
<tfoot>
    <tr>
        <th>Total</th>
        <th id="summary_total_balance" class="numeric"></th>
        <th id="summary_total_earnings" class="numeric"></th>
        <th id="summary_total_profit" class="numeric"></th>
        <th id="summary_total_loss" class="numeric"></th>
    </tr>
</tfoot>
</table>
<div class="pagebreak"></div>
<div id="tokenyearreports"></div>
`;