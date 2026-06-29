import { migrateIdbfsToOpfs, needsIdbfsMigration, clearLegacyIdbfs } from './migrate-idbfs-to-opfs.js';

const IDB_NAME = '/nearearningsdata';
const REPO = 'migtest';
const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;

function deleteIdb(name) {
    return new Promise((resolve) => {
        const r = indexedDB.deleteDatabase(name);
        r.onsuccess = r.onerror = r.onblocked = () => resolve();
    });
}

// Seed an authentic Emscripten-IDBFS database: store 'FILE_DATA', out-of-line path
// keys, values { timestamp, mode, contents } (files carry a Uint8Array).
function seedIdbfs(files) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 21);
        req.onupgradeneeded = () => {
            const store = req.result.createObjectStore('FILE_DATA');
            store.createIndex('timestamp', 'timestamp', { unique: false });
        };
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('FILE_DATA', 'readwrite');
            const store = tx.objectStore('FILE_DATA');
            const dir = (p) => store.put({ timestamp: new Date(), mode: S_IFDIR | 0o777 }, p);
            dir(IDB_NAME);
            const seen = new Set();
            for (const { path, content } of files) {
                const parts = path.split('/'); parts.pop();
                let cur = IDB_NAME;
                for (const p of parts) { cur += '/' + p; if (!seen.has(cur)) { seen.add(cur); dir(cur); } }
                store.put({ timestamp: new Date(), mode: S_IFREG | 0o666, contents: new TextEncoder().encode(content) }, `${IDB_NAME}/${path}`);
            }
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); reject(tx.error); };
        };
    });
}

async function cleanupOpfs(repoName) {
    const root = await navigator.storage.getDirectory();
    for (const entry of [repoName, `.idbfs-migrated-${repoName}`]) {
        try { await root.removeEntry(entry, { recursive: true }); } catch { /* not present */ }
    }
}

async function readOpfs(repoName, path) {
    const root = await navigator.storage.getDirectory();
    let dir = await root.getDirectoryHandle(repoName);
    const parts = path.split('/');
    const name = parts.pop();
    for (const p of parts) dir = await dir.getDirectoryHandle(p);
    const file = await (await dir.getFileHandle(name)).getFile();
    return new TextDecoder().decode(new Uint8Array(await file.arrayBuffer()));
}

describe('IDBFS -> OPFS migration', () => {
    beforeEach(async () => {
        await deleteIdb(IDB_NAME);
        await cleanupOpfs(REPO);
    });
    after(async () => {
        await deleteIdb(IDB_NAME);
        await cleanupOpfs(REPO);
    });

    it('reports no migration needed when there is no legacy data', async () => {
        expect(await needsIdbfsMigration(REPO)).to.equal(false);
    });

    it('migrates a legacy IDBFS repo (incl. .git) into OPFS, then is idempotent', async () => {
        await seedIdbfs([
            { path: 'accounts.json', content: '["a.near","b.near"]' },
            { path: 'accountdata/x.json', content: '{"x":1}' },
            { path: '.git/config', content: '[core]\n\trepositoryformatversion = 0\n' },
        ]);

        expect(await needsIdbfsMigration(REPO)).to.equal(true);

        const result = await migrateIdbfsToOpfs(REPO);
        expect(result.migrated).to.equal(true);
        expect(result.fileCount).to.equal(3);

        expect(await readOpfs(REPO, 'accounts.json')).to.equal('["a.near","b.near"]');
        expect(await readOpfs(REPO, 'accountdata/x.json')).to.equal('{"x":1}');
        expect(await readOpfs(REPO, '.git/config')).to.contain('repositoryformatversion');

        // marker set -> a second run is a no-op
        expect(await needsIdbfsMigration(REPO)).to.equal(false);
        expect((await migrateIdbfsToOpfs(REPO)).migrated).to.equal(false);
    });

    it('clearLegacyIdbfs removes the legacy database (call only after data is safe)', async () => {
        await seedIdbfs([{ path: 'accounts.json', content: '[]' }]);
        await migrateIdbfsToOpfs(REPO);          // marker now set
        await clearLegacyIdbfs();                // legacy IDB gone
        // marker still says migrated, and the legacy DB no longer holds data
        expect(await needsIdbfsMigration(REPO)).to.equal(false);
        await (await navigator.storage.getDirectory()).removeEntry(`.idbfs-migrated-${REPO}`).catch(() => {});
        expect(await needsIdbfsMigration(REPO)).to.equal(false); // no legacy data left either
    });
});
