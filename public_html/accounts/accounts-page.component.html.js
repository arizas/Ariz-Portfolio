export default /*html*/ `
<template id="accountRowTemplate">
    <div class="account-row mb-3">
        <div class="input-group">
            <input type="text" class="accountname form-control" placeholder="account.near">
            <input type="number" class="fundamount form-control" min="0" step="any" value="1"
                   style="max-width:6rem" title="ARIZ to fund / daily cap">
            <button class="btn btn-outline-primary fundButton" type="button"
                    title="Send ARIZ to this account from your connected wallet">Fund</button>
            <button class="btn btn-outline-success authorizeButton" type="button"
                    title="Authorize syncing — signs with this account's own wallet">Authorize</button>
            <button class="btn btn-danger removeAccountButton" type="button"><i class="bi bi-trash"></i></button>
        </div>
        <div class="arizstatus small text-muted mt-1">…</div>
    </div>
</template>

<div class="card">
    <div class="card-header">Accounts</div>
    <div class="card-body">
        <p class="text-muted small mb-2">
            For the gateway to sync an account it must hold ARIZ and authorize deductions.
            <strong>Fund</strong> sends ARIZ from your connected wallet; <strong>Authorize</strong> is signed by the
            account's own wallet (connect it when prompted).
        </p>
        <div id="accountsTable"></div>
    </div>
    <div class="card-footer">
        <button id="addAccountButton" class="btn btn-primary">Add account</button>
        <button type="button" class="btn btn-outline-primary ms-2" id="fundallbutton" title="Fund every listed account that has no ARIZ, from your connected wallet">Fund all</button>
        <button type="button" class="btn btn-success ms-2" id="loadfromexportbutton" title="Download complete transaction history from server">load from server</button>
    </div>
</div>
`;
