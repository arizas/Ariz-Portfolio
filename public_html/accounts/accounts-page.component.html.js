export default /*html*/ `
<template id="accountRowTemplate">
    <div class="input-group">
        <input type="text" class="accountname form-control"></td>
        <button class="btn btn-danger removeAccountButton"><i class="bi bi-trash"></i></button>
    </div>
</template>

<div class="card">
    <div class="card-header">Accounts</div>
    <div class="card-body">
        <div id="accountsTable"></div>
    </div>
    <div class="card-footer">
        <button id="addAccountButton" class="btn btn-primary">Add account</button>
        <button type="button" class="btn btn-success ms-2" id="loadfromexportbutton" title="Download complete transaction history from server">load from server</button>
    </div>
</div>
`;