export default /*html*/ `<style>
    .ariz-stat { margin-bottom: 0.5rem; }
    .ariz-stat .label { color: var(--bs-secondary-color, #6c757d); margin-right: 0.5rem; }
    .ariz-value { font-variant-numeric: tabular-nums; font-weight: 500; }
    #authrow { max-width: 28rem; }
    .ariz-section { margin: 1rem 0; }
</style>
<h3>Ariz credits</h3>
<p class="text-muted small mb-3">
    Buy <strong>ARIZ</strong> and authorise the Ariz gateway to deduct ARIZ for the FastNear API
    usage of syncing your account. Deductions happen at most once per day, up to the daily cap you set,
    and the tokens go to the arizcredits.near treasury.
</p>

<div id="signedout" style="display:none;" class="alert alert-info">
    Please log in (button at the top right) to manage your Ariz credits.
</div>

<div id="panel" style="display:none;">
    <div class="ariz-stat"><span class="label">Account</span><span class="ariz-value" id="acct"></span></div>
    <div class="ariz-stat"><span class="label">ARIZ balance</span><span class="ariz-value" id="balance">…</span></div>
    <div class="ariz-stat"><span class="label">Gateway authorisation</span><span class="ariz-value" id="authstatus">…</span></div>
    <div class="ariz-stat"><span class="label">Spent today</span><span class="ariz-value" id="spent">…</span></div>

    <div class="ariz-section">
        <button id="buybtn" class="btn btn-primary">Buy 3 ARIZ for 0.5 NEAR</button>
    </div>

    <div class="ariz-section">
        <label for="maxperday" class="form-label">Daily deduction cap (ARIZ)</label>
        <div class="input-group" id="authrow">
            <input type="number" min="0" step="any" class="form-control" id="maxperday" placeholder="e.g. 1" />
            <button id="authbtn" class="btn btn-success">Authorise gateway</button>
        </div>
    </div>

    <div class="ariz-section">
        <button id="revokebtn" class="btn btn-outline-danger">Revoke authorisation</button>
    </div>

    <div id="ariz-error" class="text-danger small" style="display:none;"></div>
</div>
`;
