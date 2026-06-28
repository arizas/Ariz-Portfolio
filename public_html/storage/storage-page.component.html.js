export default /*html*/ `<div class="card">
    <div class="card-header">Store data on the Ariz gateway git server</div>
    <div class="card-body">
        <p>Your portfolio data lives in an in-browser git repository. <b>Synchronize</b> pushes it to your private repository on the Ariz gateway, authenticated with your signed-in NEAR account.</p>
        <p>Signed in as: <span id="gatewayaccountspan">(not signed in)</span></p>
        <p>
            <button class="btn btn-primary" id="syncbutton">Synchronize</button>
            <button class="btn btn-secondary" id="downloadzipbutton">Download as zip file</button>
            <button class="btn btn-outline-danger" id="deletelocaldatabutton">Delete local data</button>
        </p>
        <hr />
        <h6>Use from the command line (optional)</h6>
        <p>Clone your repository, passing your current access token as an HTTP header:</p>
        <pre class="border rounded p-2 bg-light" style="white-space:pre-wrap;word-break:break-all;"><code id="clonecmd">Sign in, then click &ldquo;Copy clone command&rdquo;.</code></pre>
        <button class="btn btn-sm btn-outline-primary" id="copyclonebutton">Copy clone command</button>
        <p class="mt-3">Token expired in an existing clone? Update it (run inside the cloned repo):</p>
        <pre class="border rounded p-2 bg-light" style="white-space:pre-wrap;word-break:break-all;"><code id="configcmd">Sign in, then click &ldquo;Copy git config command&rdquo;.</code></pre>
        <button class="btn btn-sm btn-outline-primary" id="copyconfigbutton">Copy git config command</button>
        <p class="mt-2"><small class="text-muted">The access token is short-lived &mdash; re-copy when it expires.</small></p>
    </div>
</div>
<br />`;
