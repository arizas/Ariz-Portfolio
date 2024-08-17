import { readFile, writeFile } from 'fs/promises';

export async function createIndexedDBSnapshot(page) {
    // Extract IndexedDB data
    const indexedDBSnapshot = await page.evaluate(async () => {
        const snapshot = {};
        const dbs = await indexedDB.databases();

        for (const { name, version } of dbs) {
            const db = await new Promise((resolve, reject) => {
                const openRequest = indexedDB.open(name, version);
                openRequest.onerror = reject;
                openRequest.onsuccess = () => resolve(openRequest.result);
            });

            snapshot[name] = {};

            for (const storeName of db.objectStoreNames) {
                const tx = db.transaction(storeName, 'readonly');
                const store = tx.objectStore(storeName);

                const records = await new Promise((resolve, reject) => {
                    const allRecords = [];
                    const cursorRequest = store.openCursor();
                    cursorRequest.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            // Convert Uint8Array to base64
                            const value = cursor.value;
                            if (value.contents instanceof Uint8Array) {
                                value.contents = {
                                    type: 'Uint8Array',
                                    data: Array.from(value.contents),
                                };
                            }
                            allRecords.push({ key: cursor.key, value });
                            cursor.continue();
                        } else {
                            resolve(allRecords);
                        }
                    };
                    cursorRequest.onerror = reject;
                });

                snapshot[name][storeName] = records;
            }

            db.close();
        }

        return snapshot;
    });

    await writeFile(`indexeddbsnapshot-${new Date().toJSON()}.json`, JSON.stringify(indexedDBSnapshot, null, 1));
}

export async function restoreIndexedDBSnapshot(page, snapshotFileName) {
    // Assuming you have the snapshot as an object
    const snapshot = JSON.parse((await readFile(snapshotFileName)).toString());

    // Restore the IndexedDB from the snapshot
    await page.evaluate(async (snapshot) => {
        for (const [dbName, stores] of Object.entries(snapshot)) {
            // Open the database with the correct version, creating it if necessary
            const db = await new Promise((resolve, reject) => {
                const openRequest = indexedDB.open(dbName);
                openRequest.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    for (const storeName of Object.keys(stores)) {
                        if (!db.objectStoreNames.contains(storeName)) {
                            db.createObjectStore(storeName);
                        }
                    }
                };
                openRequest.onerror = reject;
                openRequest.onsuccess = () => resolve(openRequest.result);
            });

            // Restore data for each object store
            for (const [storeName, records] of Object.entries(stores)) {
                const tx = db.transaction(storeName, 'readwrite');
                const store = tx.objectStore(storeName);

                for (const record of records) {
                    const value = record.value;

                    // Handle Uint8Array restoration
                    if (value.contents && value.contents.type === 'Uint8Array') {
                        value.contents = new Uint8Array(value.contents.data);
                    }

                    if (value.timestamp && (typeof value.timestamp === 'string')) {
                        value.timestamp = new Date(value.timestamp);
                    }
                    store.put(value, record.key);
                }

                await tx.complete; // Ensure the transaction completes before moving on
            }

            db.close();
        }
    }, snapshot);
}
