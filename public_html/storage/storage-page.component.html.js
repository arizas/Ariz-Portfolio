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
<br />
<div class="card">
    <div class="card-header">Encrypted sync</div>
    <div class="card-body">
        <p>End-to-end encryption for your synced data: everything is encrypted in your browser before upload, with a
            master key that only your wallet can unlock &mdash; the server only ever stores ciphertext.
            <b>You are the custodian of your key</b>: export it and keep a safe copy (e.g. in a password manager).</p>
        <p>Status: <b><span id="encryptedsyncstatus">disabled</span></b></p>
        <p>
            <button class="btn btn-primary" id="enableencryptedsyncbutton">Enable encrypted sync</button>
            <button class="btn btn-outline-secondary" id="disableencryptedsyncbutton">Disable</button>
        </p>
        <p><small class="text-muted">Your wallet will ask you to sign the same message <b>twice</b>: the second
            signature verifies that your wallet signs deterministically, so it can unlock the same key again
            later. A wallet that signs differently each time cannot be used to unlock by signing (import an
            exported key instead).</small></p>
        <hr />
        <h6>Your key</h6>
        <p>Needed to enroll other devices or wallet keys, and to recover your data if you lose access to this wallet key.</p>
        <pre class="border rounded p-2 bg-light" style="white-space:pre-wrap;word-break:break-all;"><code id="exportedkey">Click &ldquo;Export key&rdquo; to reveal your key.</code></pre>
        <button class="btn btn-sm btn-outline-primary" id="exportkeybutton">Export key</button>
        <p class="mt-3">Enroll this device with a previously exported key (needed when this wallet key cannot unlock the
            encrypted store yet):</p>
        <div class="input-group">
            <input type="password" class="form-control" id="importkeyinput" placeholder="exported key (64 hex characters)" />
            <button class="btn btn-outline-primary" id="importkeybutton">Import key</button>
        </div>
        <hr />
        <h6>Use from the command line (optional)</h6>
        <p>Install the <code>egit::</code> git remote helper once:</p>
        <pre class="border rounded p-2 bg-light" style="white-space:pre-wrap;word-break:break-all;"><code>npm install -g github:petersalomonsen/encrypted-git-storage</code></pre>
        <p>Then clone your encrypted repository (decrypted locally with your exported key):</p>
        <pre class="border rounded p-2 bg-light" style="white-space:pre-wrap;word-break:break-all;"><code id="egitclonecmd">Sign in, then click &ldquo;Copy encrypted clone command&rdquo;.</code></pre>
        <button class="btn btn-sm btn-outline-primary" id="copyegitclonebutton">Copy encrypted clone command</button>
        <p class="mt-2"><small class="text-muted">The command embeds your key and a short-lived access token &mdash;
            treat it as a secret and re-copy when the token expires.</small></p>
    </div>
</div>
<br />`;
