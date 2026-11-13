export default /*html*/ `
<style>
    #transcript { white-space: pre-wrap; overflow-wrap: anywhere; }
    .entry { margin-bottom: 0.75rem; }
    .entry-user { font-weight: 600; }
    details pre { max-height: 20rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
<div class="container-fluid">
    <h3>AI assistant</h3>
    <p>Ask about your portfolio in your own words: what a figure in your Year report or Portfolio is made of, what happened on a day, or whether anything is stale, wrong or missing. It works through the app and through scripts, so most rows stay in this browser. Anything it would change waits for your approval.</p>

    <section id="modelsection" class="mb-3">
        <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
            <label for="model" class="form-label mb-0">Model</label>
            <select id="model" class="form-select w-auto"></select>
            <button id="verify" type="button" class="btn btn-sm btn-outline-secondary">Check again</button>
        </div>
        <p class="small text-body-secondary mb-2">Changing the model starts a new conversation, so nothing said to one model is sent to another.</p>
        <div id="privacy" class="alert mb-0" role="status">
            <div id="privacytext"></div>
            <details id="checks" class="mt-2" hidden>
                <summary>What this browser checked</summary>
                <ul id="checklist" class="mb-1"></ul>
                <div id="software" class="small"></div>
            </details>
            <div id="acknowledgebox" class="form-check mt-2" hidden>
                <input class="form-check-input" type="checkbox" id="acknowledge">
                <label class="form-check-label" for="acknowledge" id="acknowledgelabel"></label>
            </div>
        </div>
    </section>

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
    <p id="status" class="text-body-secondary small mb-2" role="status" hidden></p>

    <section id="changes" class="mb-3" hidden>
        <h5>Changes waiting for your approval</h5>
        <div id="changelist"></div>
    </section>

    <form id="ask" class="d-flex gap-2">
        <input id="question" class="form-control" placeholder="Ask about your portfolio" autocomplete="off">
        <button id="send" type="submit" class="btn btn-primary" disabled>Ask</button>
        <button id="stop" type="button" class="btn btn-outline-secondary" hidden>Stop</button>
    </form>
    <p id="error" class="text-danger mt-2" role="alert"></p>
</div>
`;
