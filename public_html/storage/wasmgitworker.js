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
import { repairConflictedText, hasConflictMarkers } from './jsonmerge.js';

// wasm-git (loader + the ~1MB wasm fetched from the same base) comes from
// jsdelivr, not unpkg: unpkg answers 500 for long stretches — after a ~30s hang —
// which takes the whole git worker down with it. Same CDN as jszip below.
const WASM_GIT_BASE = 'https://cdn.jsdelivr.net/npm/wasm-git@0.0.16/';
const REPO = 'portfolio';
const WORKDIR = `/opfs/${REPO}`;

let stdout = '';
let stderr = '';
let captureOutput = false;
let accessToken = 'ANONYMOUS';
let identity = null; // { username, useremail } from configureuser
let remoteUrl = null; // last URL passed to setremote — the repack URL derives from it

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
    console.log('wasm-git OPFS variant:', git.variant);

    // Recover a legacy in-browser repo (IDBFS) into OPFS on first run.
    if (await needsIdbfsMigration(REPO)) {
        await migrateIdbfsToOpfs(REPO);
    }
    // Load the repo tree from OPFS into the MEMFS cache (if any), then settle in
    // the working directory (created if this is a brand-new store).
    await git.syncRepo(REPO).catch(() => {});
    try { FS.mkdir(WORKDIR); } catch (e) { /* exists */ }
    FS.chdir(WORKDIR);
    ensureOdbPackDir();
    return git;
})();

// The IDBFS->OPFS migration copied FILES only, so repos that never held a
// packfile lost their EMPTY .git/objects/pack directory — and libgit2's fetch
// cannot create it: the downloaded pack is silently never indexed and the
// fetch dies with "target OID for the reference doesn't exist" (diagnosed
// from a real user repo). Recreate it whenever a repo is present.
function ensureOdbPackDir() {
    if (!FS.analyzePath(`${WORKDIR}/.git/objects`).exists) return;
    try { FS.mkdir(`${WORKDIR}/.git/objects/pack`); } catch (e) { /* exists */ }
}

// Run a git command via the async callMain, capturing stdout/stderr.
async function runGit(args) {
    FS.chdir(WORKDIR);
    captureOutput = true;
    stdout = '';
    stderr = '';
    let code;
    try {
        code = await git.run(args);
    } finally {
        captureOutput = false;
    }
    return { code, stdout, stderr };
}

// ---- automatic conflict resolution ------------------------------------------
//
// Two devices that both add today's prices produce two commits that touch the
// last line of the same files, which is a text conflict on every file, every
// time. libgit2 answers a conflict by writing BOTH versions into the working
// tree separated by <<<<<<< markers and leaving the merge uncommitted - and the
// next `add .` will happily stage that, which is how sixteen price files were
// committed as broken JSON and pushed to every device on 2026-08-24.
//
// So the worker never leaves a marker behind: it merges the two sides as JSON
// (jsonmerge.js knows what each file means), finishes the merge itself, and
// refuses to commit anything that still has a marker in it.

const MARKER = new TextEncoder().encode('<<<<<<< ');

/** Scan raw bytes for a conflict marker at the start of a line - no decoding unless there is one. */
function bytesHaveMarker(bytes) {
    outer: for (let i = 0; i + MARKER.length <= bytes.length; i++) {
        if (bytes[i] !== MARKER[0] || (i > 0 && bytes[i - 1] !== 0x0a)) continue;
        for (let j = 1; j < MARKER.length; j++) {
            if (bytes[i + j] !== MARKER[j]) continue outer;
        }
        return true;
    }
    return false;
}

/**
 * Index entries by path. A path listed more than once has unresolved merge
 * stages - which is how a conflicted path is identified here, rather than by
 * parsing the merge message: store paths contain spaces and emoji (there is a
 * scam token whose name is a whole sentence), so a line of prose naming three
 * of them cannot be split back apart reliably.
 */
async function indexPathCounts() {
    const counts = new Map();
    for (const path of (await runGit(['ls-files'])).stdout.split('\n')) {
        if (path) counts.set(path, (counts.get(path) ?? 0) + 1);
    }
    return counts;
}

async function conflictedPaths() {
    return [...(await indexPathCounts())].filter(([, count]) => count > 1).map(([path]) => path);
}

function mergeInProgress() {
    return FS.analyzePath(`${WORKDIR}/.git/MERGE_HEAD`).exists;
}

/** Working-tree bytes for one path, or null if it is not there. */
function readWorktree(path) {
    const full = `${WORKDIR}/${path}`;
    if (!FS.analyzePath(full).exists) return null;
    try {
        return FS.readFile(full);
    } catch (e) {
        return null; // a directory, or unreadable - nothing to scan
    }
}

/**
 * Rebuild any tracked file that has conflict markers in it, by merging the two
 * versions the markers hold.
 *
 * The markers are the source, not the commits behind them, because reading a
 * blob out of a commit means reading git's stdout - and emscripten never
 * flushes the last line of a command that ends without a newline (which every
 * file this store writes does). That line silently reappears in front of the
 * NEXT command's output, so `cat-file` hands back a JSON document with its
 * closing bracket missing. The markers are complete and need no I/O.
 *
 * This is also what heals a store that already CONTAINS a marker commit: it
 * needs no network and no access to the commits the file came from, so whichever
 * device syncs first repairs it for all of them.
 */
async function repairMarkedFiles() {
    const repaired = [];
    const stillMarked = [];
    for (const path of (await indexPathCounts()).keys()) {
        const bytes = readWorktree(path);
        if (!bytes || !bytesHaveMarker(bytes)) continue; // the cheap check first: most files are fine
        const text = new TextDecoder().decode(bytes);
        if (!hasConflictMarkers(text)) continue;
        const merged = repairConflictedText(path, text);
        if (hasConflictMarkers(merged)) {
            stillMarked.push(path);
            continue;
        }
        await git.writeFile(REPO, path, merged);
        repaired.push(path);
    }
    return { repaired, stillMarked };
}

/**
 * Stage and commit everything. Commits even with nothing staged when a merge is
 * pending: a merge whose result happens to equal our side still has to be
 * recorded, or the branch stays behind and every later push is rejected.
 */
/**
 * Put the commit identity in the REPO's config.
 *
 * configure_user writes ~/.gitconfig, and that is enough right up until a
 * fetch+merge has happened in the same worker: the commit that finishes the
 * merge then fails with "Error creating signature - config value 'user.name'
 * was not found" even though the file is there, correct, and re-writing it
 * changes nothing (verified in the encrypted-sync harness). The merge is left
 * uncommitted, so every later merge refuses ("repository is in unexpected
 * state") and every push is a non-fast-forward — the state a device gets stuck
 * in. The repo's own config is read reliably, so the identity goes there too.
 */
async function applyIdentity() {
    if (!identity || !FS.analyzePath(`${WORKDIR}/.git`).exists) return;
    await runGit(['config', 'user.name', identity.username]);
    await runGit(['config', 'user.email', identity.useremail]);
}

async function commitAll(message) {
    await applyIdentity();
    const { repaired, stillMarked } = await repairMarkedFiles();
    // Last line of defence: a marker must never reach a commit.
    if (stillMarked.length > 0) {
        throw new Error(`refusing to commit unresolved conflicts in: ${stillMarked.join(', ')}`);
    }
    await runGit(['add', '.']);
    const merging = mergeInProgress();
    const staged = (await runGit(['status'])).stdout.indexOf('Changes to be committed:') > -1;
    if (!staged && !merging) return { committed: false, repaired };

    const commit = await runGit(['commit', '-m', message]);
    // A commit that does not take is not something to carry on from: while
    // MERGE_HEAD is still there every later merge refuses ("repository is in
    // unexpected state") and every push is a non-fast-forward. Say what git
    // said, at the point it said it.
    if (commit.code !== 0 || (merging && mergeInProgress())) {
        throw new Error(`commit failed: ${commit.stderr.trim() || commit.stdout.trim() || `exit ${commit.code}`}`);
    }
    return { committed: true, repaired };
}

async function setOrigin(url) {
    await runGit(['remote', 'remove', 'origin']);
    await runGit(['remote', 'add', 'origin', url]);
}

// The store keeps one pack per push and serves them all concatenated, which is
// a valid packfile only while no object is in two of them. A pushed MERGE
// commit breaks that: libgit2 re-sends the subtrees its merged tree shares with
// the side the store already holds, and from then on every fetch, on every
// device, dies with this.
const DUPLICATE_IN_PACK = /duplicate object [0-9a-f]{40} found in pack/;

/**
 * Rebuild the store's packs into one, using this client's git.
 *
 * The store cannot fix itself: it holds ciphertext, and telling two copies of an
 * object apart needs the deltas resolved. Pushing to the repack URL gets an
 * advertisement claiming the store has no refs, so git builds a COMPLETE pack,
 * and the store swaps its pack list for that one pack without moving any ref.
 *
 * It costs a full upload, so it is not something to do routinely — only when a
 * fetch has actually come back with a duplicate.
 *
 * @returns {Promise<string|null>} git's complaint, or null if it worked.
 */
async function repackRemote() {
    if (!remoteUrl) return 'no remote configured';
    try {
        await setOrigin(`${remoteUrl}/repack`);
        return (await runGit(['push'])).stderr.trim() || null;
    } catch (e) {
        return String(e);
    } finally {
        await setOrigin(remoteUrl);
    }
}

/** The sha the store advertises for master, or null if it cannot be read. */
async function remoteTip() {
    const { stdout } = await runGit(['ls-remote', 'origin']);
    for (const line of stdout.split('\n')) {
        const [sha, ref] = line.trim().split(/\s+/);
        if (ref === 'refs/heads/master' && /^[0-9a-f]{40}$/.test(sha ?? '')) return sha;
    }
    return null;
}

async function headSha() {
    const sha = (await runGit(['rev-parse', 'HEAD'])).stdout.trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

/**
 * A store serving a duplicate can only be rebuilt by a client that already has
 * everything in it, and the repack endpoint enforces that by requiring the
 * store's exact current tip — so check before uploading anything, rather than
 * spending a full upload on a push the store would refuse.
 *
 * Be clear about how rarely this can actually fire, so nobody relies on it: the
 * device that MEETS the duplicate is by definition behind (it is fetching), and
 * a device at the tip never meets it, because its fetch has nothing to download.
 * It helps only the narrow case of a device at the tip whose object store is
 * incomplete. A store broken by someone else's merge push is in practice
 * rebuilt with `git-remote-egit --gc`, which is what the error text says.
 *
 * This app no longer creates the damage: flattenOntoRemote keeps every push
 * linear. `git pull` from a terminal still does.
 */
async function repairDuplicateObjectStore() {
    const [tip, head] = [await remoteTip(), await headSha()];
    if (tip === null || head === null || tip !== head) {
        return 'this device is not at the store\'s tip, so it cannot rebuild it';
    }
    return await repackRemote();
}

/**
 * Turn the merge we just committed into a single commit on top of the remote.
 *
 * A MERGE commit is the one push that breaks the store: libgit2 re-sends the
 * subtrees the merged tree shares with the side the store already holds, the
 * store appends them as another pack, and every later fetch gets one pack
 * carrying the same object twice. A push of ONE commit whose parent is the
 * remote tip does not — that is the ordinary shape every sync had before two
 * devices ever diverged.
 *
 * Rebuilding the store afterwards is the alternative, and it is a full upload:
 * on a 30 MB store that took long enough to wedge the git worker, which is not
 * a price to pay on every divergent sync. Not creating the merge commit in the
 * first place costs nothing.
 *
 * The merge still happens — it is what computes the three-way result and the
 * conflicts jsonmerge.js resolves. Only its SHAPE changes: `reset --soft` moves
 * the branch back to the remote tip while the index keeps the merged tree, and
 * the commit that follows has one parent. (The reset has to come after the
 * merge commit; libgit2 refuses "reset (soft) in the middle of a merge".) The
 * superseded local commit becomes unreachable — every byte of it is in the
 * merged tree, and this store's commits are whole snapshots.
 *
 * @returns {Promise<boolean>} false when the merge added nothing to the remote.
 */
async function flattenOntoRemote(message) {
    await runGit(['reset', '--soft', 'origin/master']);
    if ((await runGit(['status'])).stdout.indexOf('Changes to be committed:') === -1) {
        return false; // the remote already had everything we merged
    }
    const commit = await runGit(['commit', '-m', message]);
    if (commit.code !== 0) {
        throw new Error(`commit failed: ${commit.stderr.trim() || `exit ${commit.code}`}`);
    }
    return true;
}

const MAX_SYNC_ATTEMPTS = 3;

async function syncWithRemote() {
    FS.chdir(WORKDIR);
    ensureOdbPackDir(); // fetch cannot create it (migrated repos lost it)

    const autoResolved = new Set();
    // Heal inherited damage before anything reads these files as JSON - a store
    // that was corrupted by an older version of this worker (or by another
    // device still running one) arrives here with markers already committed.
    for (const path of (await repairMarkedFiles()).repaired) autoResolved.add(path);
    if (autoResolved.size > 0) {
        await commitAll(`repair ${autoResolved.size} file(s) committed with conflict markers`);
    }

    let failure = null;
    let repackedStore = false;
    let repackFailure = null;
    for (let attempt = 1; attempt <= MAX_SYNC_ATTEMPTS; attempt++) {
        // fetch + merge failures are tolerated ONLY for the empty-remote first
        // sync (no origin/master yet) - but their stderr is kept, so a failing
        // push reports the true root cause instead of a bare non-fast-forward.
        let fetchErrors = (await runGit(['fetch', 'origin'])).stderr.trim();

        // Nothing can be fetched from a store serving the same object twice, so
        // rebuild it here rather than reporting three misleading errors — when
        // this device is the one that can (see repairDuplicateObjectStore).
        if (DUPLICATE_IN_PACK.test(fetchErrors)) {
            const repairError = await repairDuplicateObjectStore();
            if (repairError) {
                repackFailure = repairError;
            } else {
                repackedStore = true;
                fetchErrors = (await runGit(['fetch', 'origin'])).stderr.trim();
            }
        }

        const mergeErrors = (await runGit(['merge', 'origin/master'])).stderr.trim();

        // A conflicted merge leaves the files half-merged in the working tree
        // and the merge uncommitted. Resolve them as JSON and finish the merge
        // here - the alternative is what happened on 2026-08-24: the markers
        // sit there until the next `add .` commits and pushes them.
        const conflicted = await conflictedPaths();
        if (conflicted.length > 0 || mergeInProgress()) {
            const message = conflicted.length > 0
                ? `merge remote changes (auto-resolved ${conflicted.length} file(s))`
                : 'merge remote changes';
            const resolved = await commitAll(message);
            for (const path of resolved.repaired) autoResolved.add(path);
            // A conflict with no markers to merge is a file one side deleted:
            // the working tree holds the surviving version, which commitAll has
            // just staged, so the data is kept either way.
            for (const path of conflicted) autoResolved.add(path);
            if (resolved.committed) await flattenOntoRemote(message);
        }

        const pushErrors = (await runGit(['push'])).stderr.trim();
        if (!pushErrors) {
            if (repackFailure) console.warn('could not rebuild the store:', repackFailure);
            return { autoResolved: [...autoResolved], repackedStore };
        }
        failure = { fetchErrors, mergeErrors, pushErrors };
        // Another device pushed between our fetch and our push: fetching and
        // merging again is the whole fix, and not something to make the user
        // press Synchronize a second time for. But if the FETCH failed there is
        // nothing new to merge and the push cannot become a fast-forward, so a
        // second attempt only repeats the same three errors.
        if (fetchErrors) break;
    }

    const phases = [`push: ${failure.pushErrors}`];
    if (failure.mergeErrors) phases.unshift(`merge: ${failure.mergeErrors}`);
    if (failure.fetchErrors) phases.unshift(`fetch: ${failure.fetchErrors}`);
    // A fetch that cannot be indexed is not something the user did, and none of
    // the three phase errors say so. Name it, because the follow-on errors
    // ("origin/master not found", then a rejected push) all point elsewhere.
    if (DUPLICATE_IN_PACK.test(failure.fetchErrors)) {
        phases.push(
            '',
            'The store is serving a packfile that carries the same object twice, so nothing',
            'can be fetched from it until it is rebuilt, and no device can sync until then.',
            repackFailure ? `This device could not rebuild it: ${repackFailure}.` : '',
            'Rebuild it from a machine with the remote helper:',
            '    git-remote-egit --gc <the store URL>',
            '',
            'Pushing a MERGE commit is what leaves the store like this. This app flattens',
            'its merges before pushing, but `git pull` from a terminal does not - use',
            '`git pull --rebase` (or `git config pull.rebase true`) on that clone.',
        );
    }
    throw phases.filter((line, i) => line !== '' || i === 0 || phases[i - 1] !== '').join('\n');
}

self.onmessage = async (msg) => {
    await ready;
    const params = msg.data;
    try {
        let result;
        switch (params.command) {
            case 'configureuser':
                accessToken = params.accessToken;
                identity = { username: params.username, useremail: params.useremail };
                // Global identity (no repo needed) so commits work in any state.
                FS.writeFile('/home/web_user/.gitconfig', `[user]\n\tname = ${params.username}\n\temail = ${params.useremail}\n`);
                await applyIdentity();
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
                remoteUrl = params.remoteurl;
                await setOrigin(remoteUrl);
                break;
            case 'sync':
                result = await syncWithRemote();
                break;
            case 'deletelocal':
                await git.removeRepo(REPO);
                await clearLegacyIdbfs();
                try { await (await navigator.storage.getDirectory()).removeEntry(`.idbfs-migrated-${REPO}`); } catch (e) {}
                result = { deleted: REPO };
                break;
            case 'commitall':
                result = await commitAll('add all untracked data files');
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
