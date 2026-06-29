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

    .summary-cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 1rem;
        margin-bottom: 1.75rem;
    }
    .summary-card {
        border: 1px solid #dee2e6;
        border-radius: 0.75rem;
        padding: 1.1rem 1.25rem;
        background: #fff;
        box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
    .summary-card .label {
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #6c757d;
        margin-bottom: 0.35rem;
    }
    .summary-card .value { font-size: 1.6rem; font-weight: 600; line-height: 1.2; }
    .summary-card .sub { font-size: 0.9rem; margin-top: 0.2rem; }

    .gain { color: #198754; }
    .loss { color: #dc3545; }
    .muted { color: #6c757d; }

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
        .summary-card, .holding-card { background: #1e1e1e; border-color: #343a40; }
        .holding-card.excluded { background: #161616; }
    }
</style>

<div class="portfolio-wrap">
    <div class="portfolio-toolbar">
        <h2>Portefølje</h2>
        <div class="spacer"></div>
        <label class="d-flex align-items-center gap-2 mb-0">
            <span class="muted small">Valuta</span>
            <select id="currencyselect" class="form-select form-select-sm" style="width:auto"></select>
        </label>
        <button id="refreshbutton" class="btn btn-sm btn-outline-secondary">Oppdater</button>
    </div>

    <div id="portfolio-progress" class="mb-3"></div>

    <div id="summary" class="summary-cards" hidden></div>

    <div id="holdings"></div>

    <div id="excluded-note" class="portfolio-note" hidden></div>

    <div class="portfolio-note">
        Saldo er utledet fra transaksjonshistorikken (FIFO) og viser likvid, ikke-staket beholdning.
        Urealisert gevinst/tap = dagens markedsverdi minus kostpris. Tokens i staking holdes utenfor totalen.
        Tall bør verifiseres manuelt før bruk.
    </div>
</div>
`;
