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
                <a class="nav-item nav-link" href="/year-report" data-page="year-report">Year report</a>
                <a class="nav-item nav-link" href="/transactions" data-page="transactions">Transactions</a>
                <a class="nav-item nav-link" href="/staking" data-page="staking">Staking rewards</a>
                <a class="nav-item nav-link" href="/customexchangerates" data-page="customexchangerates">Custom exchange rates</a>
                <a class="nav-item nav-link" href="/accounts" data-page="accounts">Accounts</a>
                <a class="nav-item nav-link" href="/storage" data-page="storage">Storage</a>
                <button id="loginbutton" class="nav-item nav-button">Login</button>
            </div>
        </div>
    </div>
</nav>
<br />
<div class="container" id="mainContainer">
    Get an overview of your NEAR accounts. See your transactions, staking rewards,
    and get an annual report calculating profit and loss for each of your transactions.
</div>
`;