export default /*html*/ `<style>
    .numeric {
        text-align: right;
    }

    .transactionrow_datetime {
        white-space: nowrap;
    }

    .table-responsive {
        max-height: 300px;
    }

    table thead,
    table tfoot {
        position: sticky;
    }

    table thead {
        inset-block-start: 0;
        top: 0;
    }

    table tfoot {
        inset-block-end: 0;
        bottom: 0;
    }
    .transactionrow_signer {
        max-width: 100px;
        text-overflow: ellipsis;
    }
    .transactionrow_receiver {
        max-width: 100px;
        text-overflow: ellipsis;
    }
</style>
<h3>Transactions</h3>
<div class="row">
<div class="col-md-6">
    <label for="accountselect" class="form-label">Account</label>
    <select class="form-select" aria-label="Select account" id="accountselect">
        <option disabled selected value>Select account</option>
    </select>
</div>
<div class="col-md-6">
    <label for="currencyselect" class="form-label">Currency</label>
    <select class="form-select" aria-label="Select currency" id="currencyselect">
        <option value="near">NEAR</option>
    </select>
</div>
<template id="transactionrowtemplate">
    <tr>
        <td class="transactionrow_datetime"></td>
        <td class="transactionrow_kind"></td>
        <td class="transactionrow_balance numeric"></td>
        <td class="transactionrow_change numeric"></td>
        <td class="transactionrow_signer"></td>
        <td class="transactionrow_receiver"></td>
        <td class="transactionrow_hash"></td>
    </tr>
</template>
<div class="table-responsive">
    <table class="table table-sm">
        <thead class="table-dark">
            <th scope="col">
                date
            </th>
            <th scope="col">
                kind
            </th>
            <th scope="col">
                balance
            </th>
            <th scope="col">
                change
            </th>
            <th scope="col">
                signer
            </th>
            <th scope="col">
                receiver
            </th>
            <th scope="col">
                hash
            </th>
        </thead>
        <tbody id="transactionstable">

        </tbody>
    </table>
</div>
`;