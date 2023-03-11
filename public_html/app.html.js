export default /*html*/ `<nav class="navbar navbar-expand-md navbar-dark bg-dark">
<div class="container-fluid">
    <a class="navbar-brand" href="/">NEAR numbers</a>
    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNavAltMarkup"
        aria-controls="navbarNavAltMarkup" aria-expanded="false" aria-label="Toggle navigation">
        <span class="navbar-toggler-icon"></span>
    </button>
    <div class="collapse navbar-collapse">
        <div class="navbar-nav">                    
            <a class="nav-item nav-link" href="/year-report">Year report</a>
            <a class="nav-item nav-link" href="/transactions">Transactions</a>
            <a class="nav-item nav-link" href="/staking-rewards">Staking rewards</a>
            <a class="nav-item nav-link" href="/accounts">Accounts</a>
        </div>
    </div>
</div>
</nav>
<div class="container" id="mainContainer">
    <div class="row my-3">
        <div class="col">
            <earnings-report-config id="earnings-report-config"></earnings-report-config>
        </div>
        <div class="col">
            <div class="card">
                <div class="card-header">
                    View settings
                </div>
                <div class="card-body">
                    <label for="accountselect" class="form-label">Account</label>
                    <select class="form-select" aria-label="Select account" id="accountselect">
                        <option disabled selected value>Select account</option>
                    </select>
                    <label for="currencyselect" class="form-label">Currency</label>
                    <select class="form-select" aria-label="Select currency" id="currencyselect">
                        <option value="near">NEAR</option>
                    </select>
                </div>
            </div>
        </div>
        <div class="col">
            <wasm-git-config id="wasm-git-config"></wasm-git-config>
        </div>
    </div>
    <div class="row my-3">
        <div class="col">
            <staking-view id="staking-view"></staking-view>
        </div>
    </div>
</div>
`;