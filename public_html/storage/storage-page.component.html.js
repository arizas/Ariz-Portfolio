export default /*html*/ `<div class="card">
    <div class="card-header">Store data on the Ariz gateway &mdash; end-to-end encrypted</div>
    <div class="card-body">
        <p>Your portfolio data lives in an in-browser git repository. <b>Synchronize</b> pushes it to your private,
            <b>end-to-end encrypted</b> repository on the Ariz gateway: everything is encrypted in your browser before
            upload, with a master key that only your wallet can unlock &mdash; the server only ever stores ciphertext.
            <b>You are the custodian of your key</b>: export it and keep a safe copy (e.g. in a password manager).</p>
        <p>Signed in as: <span id="gatewayaccountspan">(not signed in)</span></p>
        <p>
            <button class="btn btn-primary" id="syncbutton">Synchronize</button>
            <button class="btn btn-secondary" id="downloadzipbutton">Download as zip file</button>
            <button class="btn btn-outline-danger" id="deletelocaldatabutton">Delete local data</button>
        </p>
        <p><small class="text-muted">On the first synchronize of a session, your wallet will ask you to sign the same
            message <b>twice</b>: the second signature verifies that your wallet signs deterministically, so it can
            unlock the same key again later. A wallet that signs differently each time cannot be used to unlock by
            signing (import an exported key instead).</small></p>
        <p id="storedkeystatus" style="display:none;"><small class="text-muted">Your unlocked key is <b>stored on this
            device</b> &mdash; syncing needs no wallet signatures.
            <button class="btn btn-sm btn-outline-danger" id="forgetkeybutton">Forget stored key</button></small></p>
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
        <pre class="border rounded p-2 bg-light" style="white-space:pre-wrap;word-break:break-all;"><code>npm install -g encrypted-git-storage</code></pre>
        <p>Then clone your encrypted repository (decrypted locally with your exported key):</p>
        <pre class="border rounded p-2 bg-light" style="white-space:pre-wrap;word-break:break-all;"><code id="egitclonecmd">Sign in, then click &ldquo;Copy encrypted clone command&rdquo;.</code></pre>
        <button class="btn btn-sm btn-outline-primary" id="copyegitclonebutton">Copy encrypted clone command</button>
        <p class="mt-3">Or configure an <b>existing</b> local repository (for example one restored from a zip export):
            adds an <code>ariz</code> remote and stores the credentials in the repo&rsquo;s <code>.git/config</code>, so plain
            <code>git pull ariz master</code> / <code>git push ariz master</code> work afterwards:</p>
        <pre class="border rounded p-2 bg-light" style="white-space:pre-wrap;word-break:break-all;"><code id="egitremotecmd">Sign in, then click &ldquo;Copy configure remote command&rdquo;.</code></pre>
        <button class="btn btn-sm btn-outline-primary" id="copyegitremotebutton">Copy configure remote command</button>
        <p class="mt-2"><small class="text-muted">Both commands embed your key and a short-lived access token &mdash;
            treat them as secrets. The token expires after about an hour: re-copy the clone command, or rerun the
            configure command to refresh the stored token. Requires encrypted-git-storage &ge; 0.1.5 for the
            configure-remote form.</small></p>
    </div>
</div>
<br />`;
