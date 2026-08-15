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
        /* Floor for the JS-computed height: if the chrome above leaves less
           room than this the document grows past the viewport, so the page
           itself can be scrolled down to the table. */
        min-height: 15rem;
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

    #pagedescription summary {
        cursor: pointer;
    }

    #pagedescription p {
        margin-bottom: 0;
    }

    /* On phones the title, description and filters used to fill almost the
       whole screen, leaving room for about two table rows. Keep the chrome as
       short as possible so the table starts high up: the description collapses
       behind its summary and the two filters sit side by side. Short screens
       (a landscape phone) need the same treatment even though they are wide.

       The :host prefix is what makes these win: the Bootstrap stylesheets are
       cloned into this shadow root *after* this style block, so a bare h3 or
       .form-select selector would lose the cascade to them on equal
       specificity. */
    @media (max-width: 767.98px), (max-height: 599.98px) {
        :host h3 {
            font-size: 1.25rem;
            margin-bottom: 0.25rem;
        }

        :host .form-label {
            font-size: 0.75rem;
            margin-bottom: 0.05rem;
        }

        :host .form-select {
            font-size: 0.875rem;
            padding-top: 0.2rem;
            padding-bottom: 0.2rem;
        }
    }

    /* On a screen with room to spare the description is expanded (see the
       matchMedia sync in the component — it must use the same condition), so
       its summary is just noise. The height part of the query keeps a
       landscape phone on the collapsed layout: it is wide, but the few hundred
       pixels it has vertically all need to go to the table. */
    @media (min-width: 768px) and (min-height: 600px) {
        #pagedescription summary {
            display: none;
        }
    }
</style>
<h3>Transactions</h3>
<details id="pagedescription" class="text-muted small mb-2">
    <summary>About this page</summary>
    <p>Every balance-changing event for the selected account: NEAR, fungible tokens, NEAR Intents (public and confidential), and staking pool balances. Source is the raw worker records from the Ariz gateway, plus the confidential intents history (fetched per account on the <b>Accounts</b> page, stored only in your repository).</p>
</details>
<div class="row g-2 mb-2">
    <div class="col-6">
        <label for="accountselect" class="form-label">Account</label>
        <select class="form-select" aria-label="Select account" id="accountselect">
            <option disabled selected value>Select account</option>
        </select>
    </div>
    <div class="col-6">
        <label for="tokenselect" class="form-label">Token</label>
        <select class="form-select" aria-label="Filter by token" id="tokenselect" disabled>
            <option selected value="">All tokens</option>
        </select>
    </div>
</div>
<template id="transactionrowtemplate">
    <tr>
        <td class="txrow_datetime"></td>
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
