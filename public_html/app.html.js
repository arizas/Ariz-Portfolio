export default /*html*/ `
<style>
@media print {
    .container {
        width: 100% !important; /* Ensures the container takes full width */
        margin: 0 !important; /* Removes horizontal margins */
        max-width: none !important; /* Ensures there's no max-width limit */
        padding: 0 !important; /* Removes padding if there's any */
        min-width: 0 !important; /* Ensures there's no min-width limit */
        position: static !important; /* Resets position property */
        float: none !important; /* Avoids floating */
        border: none !important; /* Removes any borders */
        box-shadow: none !important; /* Clears box shadows */
    }
}
</style>
<nav class="navbar navbar-expand-md navbar-dark bg-dark">
    <div class="container-fluid">
        <a class="navbar-brand nav-link" href="/">NEAR account report</a>
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNavAltMarkup"
            aria-controls="navbarNavAltMarkup" aria-expanded="false" aria-label="Toggle navigation">
            <span class="navbar-toggler-icon"></span>
        </button>
        <div class="collapse navbar-collapse" id="navbarNavAltMarkup">
            <div class="navbar-nav">
                <a class="nav-item nav-link" href="/portfolio" data-page="portfolio">Portfolio</a>
                <a class="nav-item nav-link" href="/year-report" data-page="year-report">Year report</a>
                <a class="nav-item nav-link" href="/transactions" data-page="transactions">Transactions</a>
                <a class="nav-item nav-link" href="/staking" data-page="staking">Staking rewards</a>
                <a class="nav-item nav-link" href="/customexchangerates" data-page="customexchangerates">Custom exchange rates</a>
                <a class="nav-item nav-link" href="/counterparties" data-page="counterparties">Counterparties</a>
                <a class="nav-item nav-link" href="/accounts" data-page="accounts">Accounts</a>
                <a class="nav-item nav-link" href="/storage" data-page="storage">Storage</a>
                <a class="nav-item nav-link" href="/arizcredits" data-page="arizcredits">Ariz credits</a>
                <button id="loginbutton" class="nav-item nav-button">Login</button>
            </div>
        </div>
    </div>
    
</nav>
<br />
<div class="container" id="mainContainer">
    <div class="px-3 py-4 py-md-5 text-center">
        <h1 class="display-5 fw-bold">Your keys. Your crypto. Full clarity.</h1>
        <p class="lead text-muted mx-auto" style="max-width: 640px;">
            Ariz gives you a clean overview of your NEAR accounts — transactions, staking rewards,
            and an annual report with profit and loss for every transaction. Non-custodial, so your
            keys and funds never leave your hands.
        </p>
    </div>

    <div class="row g-3 g-md-4">
        <div class="col-md-4">
            <div class="card h-100 border-0 shadow-sm">
                <div class="card-body">
                    <i class="bi bi-shield-lock fs-3"></i>
                    <h6 class="card-title mt-2 fw-semibold">Non-custodial by design</h6>
                    <p class="card-text text-muted small mb-0">
                        Your keys and your funds stay yours &mdash; we never touch them.
                        We only read on-chain data to generate your reports, which we
                        store securely to give you history over time.
                    </p>
                </div>
            </div>
        </div>
        <div class="col-md-4">
            <div class="card h-100 border-0 shadow-sm">
                <div class="card-body">
                    <i class="bi bi-wallet2 fs-3"></i>
                    <h6 class="card-title mt-2 fw-semibold">Your whole portfolio</h6>
                    <p class="card-text text-muted small mb-0">
                        NEAR, staking, and NEAR Intents holdings in one overview,
                        valued in the currency you choose.
                    </p>
                </div>
            </div>
        </div>
        <div class="col-md-4">
            <div class="card h-100 border-0 shadow-sm">
                <div class="card-body">
                    <i class="bi bi-file-earmark-text fs-3"></i>
                    <h6 class="card-title mt-2 fw-semibold">Built for tax reporting</h6>
                    <p class="card-text text-muted small mb-0">
                        An annual report with FIFO profit and loss per transaction — designed to make
                        crypto tax reporting manageable. Verify the numbers before you file.
                    </p>
                </div>
            </div>
        </div>
    </div>

    <div class="alert alert-light border mt-4 mb-2 small text-muted" role="alert">
        <strong>Disclaimer.</strong>
        This tool is not financial, investment, or tax advice. Reports are based on the user's
        configuration and the calculations of the software. Users should verify the correctness of
        the calculations and ensure that all relevant data is collected — the software does not
        guarantee correctness in calculations or accuracy and completeness in the underlying data.
        The source code is open and available at
        <a href="https://github.com/arizas/Ariz-Portfolio" target="_blank" rel="noopener noreferrer">
            <i class="bi bi-github"></i> github.com/arizas/Ariz-Portfolio</a>.
    </div>
</div>
`;