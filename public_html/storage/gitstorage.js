import { isProgressBarVisible, setProgressbarValue } from "../ui/progress-bar.js";

// The git worker uses the OPFS wasm-git build, which loads wasm-git as an ES
// module from a CDN — that can't be served by the wtr dev server. So wtr (unit
// tests) opts into a tiny in-memory filesystem instead of the worker by setting
// `globalThis.__GITSTORAGE_MEMFS__`; the real worker is exercised in Playwright
// (test_servers/opfs-worker-harness.mjs). Production always uses the worker.
const useMemFs = typeof globalThis !== 'undefined' && globalThis.__GITSTORAGE_MEMFS__ === true;

let worker = useMemFs ? null : new Worker(new URL('wasmgitworker.js', import.meta.url), { type: 'module' });

/**
 * Terminate and recreate the git worker (state is in OPFS, so nothing is lost;
 * configure_user must be re-sent afterwards). Needed when the encrypted-sync
 * service worker is registered for the FIRST time: this worker was created
 * before the SW claimed the page, so its /egit requests would bypass the SW —
 * a worker created after the claim is controlled.
 */
export async function restartGitWorker() {
    if (useMemFs) return;
    while (currentCommandInProgress) {
        await currentCommandInProgress.catch(() => { });
    }
    worker.terminate();
    worker = new Worker(new URL('wasmgitworker.js', import.meta.url), { type: 'module' });
}

let currentCommandInProgress;
const workerCommand = async (command, params) => {
    while (currentCommandInProgress) {
        await currentCommandInProgress;
    }
    currentCommandInProgress = new Promise((resolve, reject) => {
        const progressBarWasAlreadyVisible = isProgressBarVisible();
        worker.onmessage = (msg) => {
            if (msg.data.error) {
                if (!progressBarWasAlreadyVisible) {
                    setProgressbarValue(null);
                }
                currentCommandInProgress = null;
                reject(msg.data.error);
            } else if (msg.data.progress) {
                setProgressbarValue('indeterminate', msg.data.progress);
            } else {
                if (!progressBarWasAlreadyVisible) {
                    setProgressbarValue(null);
                }
                currentCommandInProgress = null;
                resolve(msg.data);
            }
        }
        worker.postMessage(Object.assign(params, { command }));
    });
    return currentCommandInProgress;
}

// ---- in-memory filesystem (wtr only) ------------------------------------------
const mem = new Map(); // normalized relative path -> file content
const memKey = (p) => {
    let s = String(p);
    if (s.startsWith('./')) s = s.slice(2);
    if (s === '.') return '';
    return s.replace(/^\/+/, '').replace(/\/+$/, '');
};
const memExists = (p) => {
    const k = memKey(p);
    if (k === '') return true;
    if (mem.has(k)) return true;
    const base = k + '/';
    for (const key of mem.keys()) if (key.startsWith(base)) return true;
    return false;
};
const memReaddir = (dir) => {
    const k = memKey(dir);
    const base = k === '' ? '' : k + '/';
    const names = new Set(['.', '..']); // match Emscripten FS.readdir
    for (const key of mem.keys()) {
        if (base === '' || key.startsWith(base)) {
            const name = key.slice(base.length).split('/')[0];
            if (name) names.add(name);
        }
    }
    return [...names];
};

export async function writeFile(filename, content) {
    if (useMemFs) { mem.set(memKey(filename), content); return; }
    return await workerCommand('writeFile', { filename, content });
}

export async function readTextFile(filename) {
    if (useMemFs) {
        const k = memKey(filename);
        if (!mem.has(k)) throw new Error('no such file: ' + filename);
        return mem.get(k);
    }
    return (await workerCommand('readTextFile', { filename })).result;
}

export async function exists(path) {
    if (useMemFs) return memExists(path);
    return (await workerCommand('exists', { path })).result;
}

export async function mkdir(path) {
    if (useMemFs) return; // directories are implicit in the in-memory map
    await workerCommand('mkdir', { path });
}

export async function readdir(path) {
    if (useMemFs) return memReaddir(path);
    return (await workerCommand('readdir', { path })).result;
}

export async function git_init() {
    if (useMemFs) return;
    return (await workerCommand('git', ['init', '.'])).result;
}

export async function git_clone(remoteurl) {
    if (useMemFs) return;
    return (await workerCommand('git', ['clone', remoteurl, '.'])).result;
}

export async function commit_all() {
    if (useMemFs) return;
    return (await workerCommand('commitall', [])).result;
}

export async function configure_user(params) {
    if (useMemFs) return;
    return (await workerCommand('configureuser', params)).result;
}

export async function set_remote(remoteurl) {
    if (useMemFs) return;
    return (await workerCommand('setremote', { remoteurl })).result;
}

export async function get_remote() {
    if (useMemFs) return null;
    const remote = (await workerCommand('getremote', [])).result;
    if (remote) {
        return remote.split('\n')[0].split(/\s+/)[1];
    } else {
        return null;
    }
}

export async function sync() {
    if (useMemFs) return;
    await workerCommand('sync', []);
}

export async function push() {
    if (useMemFs) return;
    await workerCommand('git', ['push']);
}

export async function delete_local() {
    if (useMemFs) { mem.clear(); return; }
    await workerCommand('deletelocal', []);
}

export async function exportZip() {
    if (useMemFs) return 'blob:mock';
    return (await workerCommand('exportzip', [])).result.zipUrl;
}

export async function exportAndDownloadZip() {
    const url = await exportZip();
    const a = document.createElement('a');
    a.href = url;
    a.download = 'accountreportfiles.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
