export default /*html*/ `
<style>
    #transcript { white-space: pre-wrap; overflow-wrap: anywhere; }
    .entry { margin-bottom: 0.75rem; }
    .entry-user { font-weight: 600; }
    details pre { max-height: 20rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
<div class="container-fluid">
    <h3>Data check</h3>
    <p>Ask an AI model what is stale, wrong or missing in your stored data, or ask it to explain a figure in your Year report or Portfolio. It works through scripts, so most rows stay in this browser.</p>

    <div class="alert alert-warning" role="alert">
        <strong>Not yet private enough for real financial data.</strong>
        Your questions, plus whatever the model reads or its scripts print, go to NEAR AI over ordinary TLS.
        This page does not yet verify that the model runs in a trusted environment, and does not use end-to-end encryption.
        <div class="form-check mt-2">
            <input class="form-check-input" type="checkbox" id="acknowledge">
            <label class="form-check-label" for="acknowledge">I understand, and accept this for the data in this store</label>
        </div>
    </div>

    <section id="connect" class="mb-3">
        <p id="connection"></p>
        <div class="d-flex flex-wrap gap-2 align-items-center">
            <button id="connectwallet" class="btn btn-primary">Connect with wallet</button>
            <input id="pastedkey" type="password" class="form-control w-auto" placeholder="Or paste a NEAR AI key" autocomplete="off">
            <button id="usekey" class="btn btn-secondary">Use key</button>
            <button id="forget" class="btn btn-outline-secondary" hidden>Disconnect</button>
        </div>
    </section>

    <div id="transcript" aria-live="polite"></div>

    <section id="changes" class="mb-3" hidden>
        <h5>Changes waiting for your approval</h5>
        <div id="changelist"></div>
    </section>

    <form id="ask" class="d-flex gap-2">
        <input id="question" class="form-control" placeholder="Is anything stale, wrong or missing?" autocomplete="off">
        <button id="send" type="submit" class="btn btn-primary" disabled>Ask</button>
        <button id="stop" type="button" class="btn btn-outline-secondary" hidden>Stop</button>
    </form>
    <p id="error" class="text-danger mt-2" role="alert"></p>
</div>
`;
