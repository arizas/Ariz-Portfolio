// OPFS-backed git worker (wasm-git 0.0.15, SAB-free). Module worker.
//
// Replaces the legacy IDBFS worker. Same message protocol as before, so
// gitstorage.js / domainobjectstore / the storage page are unchanged. Internals:
//  - loads the auto-selected OPFS build (pthreads if cross-origin isolated, else
//    JSPI, else ASYNCIFY) via lg2_opfs_auto.js; callMain is async.
//  - one repo at /opfs/<REPO>; MEMFS is a cache, git's C writes auto-persist to
//    OPFS. App file writes go through the facade's writeFile (opfsWriteFile) since
//    a plain FS.writeFile would not persist.
//  - on startup, migrates a legacy IDBFS repo into OPFS if present.

import { migrateIdbfsToOpfs, needsIdbfsMigration, clearLegacyIdbfs } from './migrate-idbfs-to-opfs.js';

const WASM_GIT_BASE = 'https://unpkg.com/wasm-git@0.0.16/';
const REPO = 'portfolio';
const WORKDIR = `/opfs/${REPO}`;

let stdout = '';
let stderr = '';
let captureOutput = false;
let accessToken = 'ANONYMOUS';

// The OPFS builds use the synchronous HTTP transport (XHR) — inject the gateway
// bearer token on every request, same as the legacy worker did.
XMLHttpRequest.prototype._open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
    this._open(method, url, async, user, password);
    this.setRequestHeader('Authorization', `Bearer ${accessToken}`);
};

let git, FS;
const ready = (async () => {
    const { loadOpfsGit } = await import(/* @vite-ignore */ `${WASM_GIT_BASE}lg2_opfs_auto.js`);
    git = await loadOpfsGit({
        baseUrl: WASM_GIT_BASE,
        moduleOverrides: {
            print: (text) => { if (captureOutput) stdout += text + '\n'; postMessage({ progress: text }); },
            printErr: (text) => { if (captureOutput) stderr += text + '\n'; console.error(text); },
        },
    });
    FS = git.FS;

    // Recover a legacy in-browser repo (IDBFS) into OPFS on first run.
    if (await needsIdbfsMigration(REPO)) {
        await migrateIdbfsToOpfs(REPO);
    }
    // Load the repo tree from OPFS into the MEMFS cache (if any), then settle in
    // the working directory (created if this is a brand-new store).
    await git.syncRepo(REPO).catch(() => {});
    try { FS.mkdir(WORKDIR); } catch (e) { /* exists */ }
    FS.chdir(WORKDIR);
    return git;
})();

// Run a git command via the async callMain, capturing stdout/stderr.
async function runGit(args) {
    FS.chdir(WORKDIR);
    captureOutput = true;
    stdout = '';
    stderr = '';
    try {
        await git.run(args);
    } finally {
        captureOutput = false;
    }
    return { stdout, stderr };
}

self.onmessage = async (msg) => {
    await ready;
    const params = msg.data;
    try {
        let result;
        switch (params.command) {
            case 'configureuser':
                accessToken = params.accessToken;
                // Global identity (no repo needed) so commits work in any state.
                FS.writeFile('/home/web_user/.gitconfig', `[user]\n\tname = ${params.username}\n\temail = ${params.useremail}\n`);
                result = { accessTokenConfigured: true };
                break;
            case 'writeFile':
                await git.writeFile(REPO, params.filename, params.content); // persists to OPFS
                break;
            case 'readTextFile':
                result = FS.readFile(`${WORKDIR}/${params.filename}`, { encoding: 'utf8' });
                break;
            case 'exists':
                result = FS.analyzePath(`${WORKDIR}/${params.path}`).exists;
                break;
            case 'mkdir':
                FS.mkdir(`${WORKDIR}/${params.path}`);
                break;
            case 'readdir':
                result = FS.readdir(`${WORKDIR}/${params.path}`);
                break;
            case 'git':
                result = await runGit(params); // params is the args array
                break;
            case 'getremote':
                result = (await runGit(['remote', 'show', '-v'])).stdout;
                break;
            case 'setremote':
                await runGit(['remote', 'remove', 'origin']);
                await runGit(['remote', 'add', 'origin', params.remoteurl]);
                break;
            case 'sync': {
                FS.chdir(WORKDIR);
                captureOutput = true; stdout = ''; stderr = '';
                await git.run(['fetch', 'origin']);
                await git.run(['merge', 'origin/master']);
                // First push to an empty remote has no origin/master; only a failed
                // push is fatal (mirror of the legacy worker's fix).
                stdout = ''; stderr = '';
                await git.run(['push']);
                captureOutput = false;
                if (stderr) throw stderr;
                result = stdout;
                break;
            }
            case 'deletelocal':
                await git.removeRepo(REPO);
                await clearLegacyIdbfs();
                try { await (await navigator.storage.getDirectory()).removeEntry(`.idbfs-migrated-${REPO}`); } catch (e) {}
                result = { deleted: REPO };
                break;
            case 'commitall':
                // Stage everything (0.0.16 normalizes the '.'), then commit only if
                // there's something staged. Robust vs parsing `git status` text.
                await runGit(['add', '.']);
                if ((await runGit(['status'])).stdout.indexOf('Changes to be committed:') > -1) {
                    await runGit(['commit', '-m', 'add all untracked data files']);
                }
                break;
            case 'exportzip': {
                const { default: JSZip } = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
                const zip = new JSZip();
                const addToZip = (dir) => {
                    for (const entry of FS.readdir(dir)) {
                        if (entry === '.' || entry === '..') continue;
                        const path = `${dir}/${entry}`;
                        const stat = FS.stat(path);
                        if (FS.isDir(stat.mode)) addToZip(path);
                        else if (FS.isFile(stat.mode)) zip.file(path, FS.readFile(path));
                    }
                };
                addToZip(WORKDIR);
                result = { zipUrl: URL.createObjectURL(await zip.generateAsync({ type: 'blob' })) };
                break;
            }
        }
        postMessage({ result });
    } catch (error) {
        postMessage({ error: error.toString() });
    }
};
