export default /*html*/ `<div class="card">
    <div class="card-header">Store data on a git server</div>
    <div class="card-body">
        <p>You may store a remote copy of your data in a git server, which you can then use to synchronize with other browsers and devices</p>
        <p>Create a git repostiory at <a target="_blank" href="https://wasm-git.petersalomonsen.com">wasm-git.petersalomonsen.com</a> and then
        log in and synchronize it here.</p>

        <p>
            <span id="currentuserspan"></span>
            <button class="btn btn-primary" id="loginbutton">Login</button>
            <button class="btn btn-warning" id="logoutbutton">Logout</button>
        </p>
        <p>
        <label for="remoterepo" class="form-label">URL to git repository</label>
        <input type="text" class="form-control" id="remoterepo" placeholder="https://wasm-git.petersalomonsen.com/YOUR_ACCOUNT-nearsight">
        </p>
        <button class="btn btn-primary" id="syncbutton">Synchronize</button>
        <button class="btn btn-primary" id="deletelocaldatabutton">Delete local data</button>
    </div>
</div>`;
