export default /*html*/ `<style>
    .numeric {
        text-align: right;
    }

    .publickey {
        font-family: var(--bs-font-monospace);
        font-size: 0.85em;
        white-space: nowrap;
    }

    .keydate {
        white-space: nowrap;
    }

    tr.deleted td {
        opacity: 0.55;
    }

    .keynotes {
        min-width: 12rem;
    }
</style>
<template id="keyrowtemplate">
    <tr>
        <td><span class="publickey"></span></td>
        <td class="keyaccess"></td>
        <td class="keydate keyadded"></td>
        <td class="numeric keysigned"></td>
        <td class="keydate keylastused"></td>
        <td class="keynotes">
            <input type="text" class="form-control form-control-sm keylabel" placeholder="Where is this key? (wallet, device)">
            <textarea class="form-control form-control-sm mt-1 keytext" rows="1" placeholder="Notes"></textarea>
        </td>
        <td><button class="btn btn-sm btn-outline-danger keydelete">Remove</button></td>
    </tr>
</template>

<div class="card">
    <div class="card-header">Access keys</div>
    <div class="card-body">
        <p class="text-muted small mb-2">
            Every key that can sign for the account. A <strong>full access</strong> key can do anything, including
            moving all funds and adding or removing keys; a <strong>function call</strong> key can only call the
            contract it names. The chain doesn't say which wallet or device holds a key, so write that down here.
            Your notes are stored in your repository, next to the account's other data.
        </p>
        <p class="text-muted small mb-2">
            <strong>Find last use</strong> looks through FastNear's index of the transactions the account signed,
            newest first, including those a relayer submitted for it. Signing a message (for example to sign in to an
            app) never reaches the chain, so a key used only for that looks unused here. The lookups go through the
            Ariz gateway, which needs you signed in, and are paid in ARIZ.
        </p>
        <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
            <select class="form-select w-auto" id="accountselect"></select>
            <button class="btn btn-primary" id="refreshbutton">Check keys on chain</button>
            <button class="btn btn-outline-primary" id="lastusebutton"
                title="Look up which key signed each of the account's transactions">Find last use</button>
            <span class="text-muted small" id="checkedat"></span>
        </div>
        <div class="alert alert-danger" id="error" hidden></div>
        <p class="text-muted small mb-2" id="lastusestatus"></p>
        <p class="mb-2" id="summary"></p>
        <div class="table-responsive">
            <table class="table table-sm align-middle">
                <thead>
                    <tr>
                        <th>Public key</th>
                        <th>Access</th>
                        <th>Added</th>
                        <th class="numeric" title="Transactions signed, counted from the key's nonce">Signed</th>
                        <th>Last used</th>
                        <th>Where / notes</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody id="keystable"></tbody>
            </table>
        </div>
    </div>
</div>
`;
