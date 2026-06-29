// One-time migration of the legacy in-browser repo from Emscripten IDBFS (the
// store the old wasm-git `lg2.js`/IDBFS build wrote) into OPFS, so the OPFS-backed
// build can pick it up. Same-origin, no sign-in, no network, no wasm.
//
// We read the legacy IndexedDB directly. Emscripten IDBFS keeps one database named
// after the mount path ('/nearearningsdata') with an object store 'FILE_DATA':
// out-of-line keys are absolute paths; values are { timestamp, mode, contents }
// (files carry a Uint8Array `contents`; dirs are mode-only). This format is stable
// and we only ever read a fixed legacy snapshot, so direct reads are safe.
//
// The write side uses the browser OPFS API (the OPFS build stores plain files in
// OPFS). Idempotent: a marker file in the OPFS root is written only after a full
// copy, so a crashed run just re-copies next time.

const LEGACY_IDB_NAME = '/nearearningsdata';
const LEGACY_FS_STORE = 'FILE_DATA';
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const marker = (repoName) => `.idbfs-migrated-${repoName}`;

function openLegacyIdb() {
    // Open without a version so an existing DB is read at its current version with
    // no upgrade. If it doesn't exist, abort the implicit upgrade so we don't
    // create an empty database as a side effect.
    return new Promise((resolve, reject) => {
        let req;
        try { req = indexedDB.open(LEGACY_IDB_NAME); } catch (e) { reject(e); return; }
        req.onupgradeneeded = (e) => { try { e.target.transaction.abort(); } catch { /* */ } };
        req.onerror = () => resolve(null);   // missing / aborted -> no legacy DB
        req.onblocked = () => resolve(null);
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(LEGACY_FS_STORE)) { db.close(); resolve(null); return; }
            resolve(db);
        };
    });
}

function toUint8(contents) {
    if (contents instanceof Uint8Array) return contents;
    if (contents instanceof ArrayBuffer) return new Uint8Array(contents);
    if (Array.isArray(contents)) return Uint8Array.from(contents);
    return new Uint8Array(contents);
}

// Read every regular file out of the legacy IDBFS store as { path (relative), data }.
function readLegacyRepo() {
    return new Promise(async (resolve, reject) => {
        const db = await openLegacyIdb();
        if (!db) { resolve([]); return; }
        const files = [];
        const prefix = LEGACY_IDB_NAME + '/';
        const cursorReq = db.transaction(LEGACY_FS_STORE, 'readonly').objectStore(LEGACY_FS_STORE).openCursor();
        cursorReq.onerror = () => { db.close(); reject(cursorReq.error); };
        cursorReq.onsuccess = (e) => {
            const cursor = e.target.result;
            if (!cursor) { db.close(); resolve(files); return; }
            const path = String(cursor.key);
            const entry = cursor.value;
            if (entry && (entry.mode & S_IFMT) === S_IFREG && entry.contents != null && path.startsWith(prefix)) {
                files.push({ path: path.slice(prefix.length), data: toUint8(entry.contents) });
            }
            cursor.continue();
        };
    });
}

async function migrationMarkerExists(repoName) {
    try {
        const root = await navigator.storage.getDirectory();
        await root.getFileHandle(marker(repoName));
        return true;
    } catch { return false; }
}

/** True if there is legacy IDBFS data that hasn't been migrated into OPFS yet. */
export async function needsIdbfsMigration(repoName) {
    if (await migrationMarkerExists(repoName)) return false;
    return (await readLegacyRepo()).length > 0;
}

async function writeRepoToOpfs(repoName, files) {
    const root = await navigator.storage.getDirectory();
    const repoDir = await root.getDirectoryHandle(repoName, { create: true });
    for (const { path, data } of files) {
        const parts = path.split('/');
        const fileName = parts.pop();
        let dir = repoDir;
        for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
        const fh = await dir.getFileHandle(fileName, { create: true });
        const writable = await fh.createWritable();
        await writable.write(data);
        await writable.close();
    }
}

async function writeMarker(repoName, fileCount) {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle(marker(repoName), { create: true });
    const writable = await fh.createWritable();
    await writable.write(JSON.stringify({ migratedAt: Date.now(), fileCount }));
    await writable.close();
}

/**
 * Migrate the legacy IDBFS repo into OPFS under `repoName` if needed.
 * @returns {Promise<{migrated:boolean, fileCount:number}>}
 */
export async function migrateIdbfsToOpfs(repoName) {
    if (await migrationMarkerExists(repoName)) return { migrated: false, fileCount: 0 };
    const files = await readLegacyRepo();
    if (files.length === 0) return { migrated: false, fileCount: 0 };
    await writeRepoToOpfs(repoName, files);
    await writeMarker(repoName, files.length); // only after a full copy
    return { migrated: true, fileCount: files.length };
}

/** Delete the legacy IDBFS database. Call only once the data is safely elsewhere. */
export function clearLegacyIdbfs() {
    return new Promise((resolve) => {
        const r = indexedDB.deleteDatabase(LEGACY_IDB_NAME);
        r.onsuccess = r.onerror = r.onblocked = () => resolve();
    });
}
