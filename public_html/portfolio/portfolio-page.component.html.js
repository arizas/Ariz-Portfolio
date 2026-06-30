export default /*html*/ `
<style>
    .portfolio-wrap { margin-bottom: 3rem; }
    .portfolio-toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1.5rem;
    }
    .portfolio-toolbar h2 { margin: 0; font-size: 1.5rem; }
    .portfolio-toolbar .spacer { flex: 1; }

    .gain { color: #198754; }
    .loss { color: #dc3545; }
    .muted { color: #6c757d; }

    .card-surface {
        border: 1px solid #dee2e6;
        border-radius: 0.75rem;
        background: #fff;
    }

    .hero-card { padding: 1.1rem 1.25rem; margin-bottom: 0.5rem; }
    .hero-card .label {
        font-size: 0.85rem; color: #6c757d; margin-bottom: 0.25rem;
    }
    .hero-value { font-size: 2rem; font-weight: 600; line-height: 1.1; }
    .hero-sub { font-size: 0.9rem; color: #495057; margin-top: 0.5rem; }

    .section-label {
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #6c757d;
        margin: 1.4rem 0 0.5rem;
    }

    .result-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 0.6rem;
    }
    .metric-card { padding: 0.9rem 1rem; }
    .metric-card.result { background: #eafaf1; border-color: #b7e4c7; }
    .metric-card .label { font-size: 0.85rem; color: #6c757d; }
    .metric-card .value { font-size: 1.35rem; font-weight: 600; line-height: 1.2; }
    .metric-card .cap { font-size: 0.78rem; color: #6c757d; margin-top: 0.15rem; }
    .metric-pct { font-size: 0.85rem; font-weight: 500; }

    .footnote { font-size: 0.78rem; color: #6c757d; margin-top: 0.5rem; line-height: 1.5; }

    .balance-card {
        display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
        padding: 1rem 1.25rem;
    }
    .balance-card .label { font-size: 0.85rem; color: #6c757d; }
    .bal-value { font-size: 1.25rem; font-weight: 600; }
    .bal-arrow { font-size: 1.3rem; color: #adb5bd; }

    .holding-card {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 0.25rem 1rem;
        align-items: center;
        border: 1px solid #e9ecef;
        border-radius: 0.6rem;
        padding: 0.85rem 1.1rem;
        margin-bottom: 0.6rem;
        background: #fff;
    }
    .holding-card.excluded { opacity: 0.7; background: #f8f9fa; }
    .holding-head { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; }
    .holding-symbol { font-weight: 600; font-size: 1.05rem; }
    .holding-amount { color: #6c757d; font-size: 0.9rem; }
    .holding-values { text-align: right; }
    .holding-value { font-weight: 600; font-size: 1.05rem; }
    .holding-pl { font-size: 0.9rem; }

    .alloc-bar {
        grid-column: 1 / -1;
        height: 6px;
        border-radius: 3px;
        background: #e9ecef;
        overflow: hidden;
        margin-top: 0.5rem;
    }
    .alloc-bar > span { display: block; height: 100%; background: #0d6efd; }

    .flag {
        display: inline-block;
        font-size: 0.7rem;
        font-weight: 600;
        padding: 0.1rem 0.45rem;
        border-radius: 0.4rem;
        background: #fff3cd;
        color: #997404;
        border: 1px solid #ffe69c;
    }

    .portfolio-note { font-size: 0.85rem; color: #6c757d; margin-top: 1.5rem; }
    #portfolio-progress { color: #6c757d; }
    @media (prefers-color-scheme: dark) {
        .card-surface, .holding-card { background: #1e1e1e; border-color: #343a40; }
        .holding-card.excluded { background: #161616; }
        .metric-card.result { background: #15321f; border-color: #1f5132; }
        .hero-sub { color: #ced4da; }
    }
</style>

<div class="portfolio-wrap">
    <div class="portfolio-toolbar">
        <h2>Portfolio</h2>
        <div class="spacer"></div>
        <label class="d-flex align-items-center gap-2 mb-0">
            <span class="muted small">From</span>
            <select id="frommonthselect" class="form-select form-select-sm" style="width:auto"></select>
            <select id="fromyearselect" class="form-select form-select-sm" style="width:auto"></select>
        </label>
        <label class="d-flex align-items-center gap-2 mb-0">
            <span class="muted small">Currency</span>
            <select id="currencyselect" class="form-select form-select-sm" style="width:auto"></select>
        </label>
        <button id="refreshbutton" class="btn btn-sm btn-outline-secondary">Refresh</button>
    </div>

    <div id="portfolio-progress" class="mb-3"></div>

    <div id="summary" hidden></div>

    <div id="holdings-section" hidden>
        <div class="section-label">Holdings</div>
        <div id="holdings"></div>
        <div id="excluded-note" class="portfolio-note" hidden></div>
    </div>

    <div class="portfolio-note">
        Balances are derived from the transaction history (FIFO). Realized gain/loss is net of gas, fees
        and slippage — every swap counts as a disposal. Staked NEAR is shown separately and added to the
        total. Figures should be verified manually before use.
    </div>
</div>
`;
