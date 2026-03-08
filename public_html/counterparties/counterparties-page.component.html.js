export default /*html*/ `
<style>
    .counterparty-table {
        font-size: 0.85em;
    }
    .counterparty-table th {
        cursor: pointer;
        user-select: none;
    }
    .counterparty-table th:hover {
        background-color: var(--bs-gray-200);
    }
    .suggestion-badge {
        font-size: 0.75em;
    }
    .filter-group {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
        align-items: center;
    }
    .stats {
        font-size: 0.85em;
        color: var(--bs-gray-600);
    }
    .sort-indicator::after {
        content: ' \\25B2';
    }
    .sort-indicator.desc::after {
        content: ' \\25BC';
    }
</style>

<div class="card mb-3">
    <div class="card-header">
        <strong>Counterparty Classification</strong>
    </div>
    <div class="card-body">
        <p class="small text-muted">
            All incoming transfers from external accounts are classified as <strong>deposit</strong> by default.
            Mark accounts as <strong>received</strong> to classify their incoming transfers as external income.
            Both deposit and received enter FIFO cost basis at the same price — the distinction is for income reporting only.
        </p>
        <div class="filter-group mb-3">
            <input type="text" class="form-control form-control-sm" id="searchInput" placeholder="Search counterparty..." style="max-width: 300px;">
            <select class="form-select form-select-sm" id="filterSelect" style="max-width: 200px;">
                <option value="all">All</option>
                <option value="received">Marked as received</option>
                <option value="deposit">Deposit (default)</option>
                <option value="suggested">Suggested as received</option>
            </select>
            <button class="btn btn-sm btn-outline-primary" id="autoClassifyBtn" title="Apply auto-classification suggestions">Auto-classify</button>
            <button class="btn btn-sm btn-outline-success" id="saveBtn">Save</button>
            <span class="stats" id="statsSpan"></span>
        </div>
        <div class="table-responsive">
            <table class="table table-sm table-hover counterparty-table">
                <thead>
                    <tr>
                        <th data-sort="received" style="width: 70px;">Received</th>
                        <th data-sort="account">Counterparty</th>
                        <th data-sort="txCount" class="text-end">Txns</th>
                        <th data-sort="totalIncoming" class="text-end">Incoming</th>
                        <th data-sort="totalOutgoing" class="text-end">Outgoing</th>
                        <th data-sort="suggestion">Suggestion</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody id="counterpartyTableBody">
                </tbody>
            </table>
        </div>
        <div id="loadingIndicator" class="text-center text-muted">Loading counterparty data...</div>
    </div>
</div>
`;
