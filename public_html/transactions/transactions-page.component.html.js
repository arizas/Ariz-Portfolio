export default /*html*/ `<style>
    /* Dense table: shrink padding + font on top of Bootstrap's table-sm. */
    table.table {
        --bs-table-cell-padding-x: 0.4rem;
        --bs-table-cell-padding-y: 0.15rem;
        font-size: 0.8125rem;
        margin-bottom: 0;
    }

    .numeric {
        text-align: right;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
    }

    .txrow_datetime {
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
    }

    .txrow_token_symbol {
        white-space: nowrap;
        font-weight: 500;
        line-height: 1.1;
    }

    .txrow_token_id {
        font-size: 0.6875rem;
        color: var(--bs-secondary-color, #6c757d);
        word-break: break-all;
        line-height: 1.1;
    }

    .txrow_counterparty {
        word-break: break-all;
        font-size: 0.75rem;
    }

    .txrow_hash a {
        font-family: var(--bs-font-monospace, monospace);
        font-size: 0.75rem;
    }

    .table-responsive {
        max-height: 100%;
    }

    table thead {
        position: sticky;
        inset-block-start: 0;
        top: 0;
        z-index: 1;
    }

    #emptystate {
        margin: 1rem 0;
        color: var(--bs-secondary-color, #6c757d);
    }
</style>
<h3>Transactions</h3>
<p class="text-muted small mb-2">Every balance-changing event for the selected account: NEAR, fungible tokens, NEAR Intents, and staking pool balances. Source is the raw worker records from the Ariz gateway.</p>
<div class="row">
    <div class="col-md-6">
        <label for="accountselect" class="form-label">Account</label>
        <select class="form-select" aria-label="Select account" id="accountselect">
            <option disabled selected value>Select account</option>
        </select>
    </div>
</div>
<template id="transactionrowtemplate">
    <tr>
        <td class="txrow_datetime"></td>
        <td class="txrow_block numeric"></td>
        <td>
            <div class="txrow_token_symbol"></div>
            <div class="txrow_token_id"></div>
        </td>
        <td class="txrow_change numeric"></td>
        <td class="txrow_balance numeric"></td>
        <td class="txrow_counterparty"></td>
        <td class="txrow_hash"></td>
    </tr>
</template>
<div id="emptystate" style="display:none;"></div>
<div class="table-responsive">
    <table class="table table-sm">
        <thead class="table-dark">
            <tr>
                <th scope="col">date</th>
                <th scope="col">block</th>
                <th scope="col">token</th>
                <th scope="col">change</th>
                <th scope="col">balance after</th>
                <th scope="col">counterparty</th>
                <th scope="col">tx</th>
            </tr>
        </thead>
        <tbody id="transactionstable">
        </tbody>
    </table>
</div>
`;
