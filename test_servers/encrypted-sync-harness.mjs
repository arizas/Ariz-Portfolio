// E2E harness for encrypted gateway sync (issue #76): the real egit service
// worker (encrypted-git-storage), the real OPFS wasm-git worker, and the app's
// own plumbing (prepareSyncRemote → configureEgitKey → obtainDek), against an
// in-memory implementation of the gateway's /store/me contract.
//
//   page ──/egit/<account>/…──> service worker ──CORS──> local store server
//
// Covers: first-time SW registration (uncontrolled git worker restarted),
// wallet-unlocked key first-setup (DEK minted, wrap stored), init/commit/push
// of encrypted packs, zero-knowledge at rest (ciphertext only), authenticated
// store requests, and a fresh "device" (new browser context) unlocking via its
// stored wrap and cloning the pushed data back. Exits non-zero on failure.
//
//   node test_servers/encrypted-sync-harness.mjs
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public_html');
const EGS_ROOT = path.resolve(APP_ROOT, '../node_modules/encrypted-git-storage');
const STORE_PORT = 8098, APP_PORT = 8097;
const APP_ORIGIN = `http://localhost:${APP_PORT}`;
const STORE_ORIGIN = `http://localhost:${STORE_PORT}`;
const ACCOUNT = 'e2etest.near';
const TOKEN = 'e2e-token';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css' };
const EGS_MAGIC = Buffer.from([0x45, 0x47, 0x53, 0x31]); // "EGS1" — encrypted blob prefix

// ---- in-memory /store/me server (the makeStoreClient + key-wrap contract) ----
const store = {
    refs: null, refsEtag: 0,           // ETag CAS like the gateway/S3 conditional writes
    packs: new Map(),                  // n -> Buffer (create-only)
    keys: new Map(),                   // wrapId -> Buffer (create-only)
    badAuthRequests: [],               // non-OPTIONS requests missing the bearer token
};
function startStoreServer() {
    return http.createServer(async (req, res) => {
        const cors = {
            'Access-Control-Allow-Origin': APP_ORIGIN,
            'Access-Control-Allow-Methods': 'GET,HEAD,PUT,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? '*',
            'Access-Control-Expose-Headers': 'ETag',
        };
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
        if (req.headers.authorization !== `Bearer ${TOKEN}`) {
            store.badAuthRequests.push(`${req.method} ${req.url}`);
            res.writeHead(401, cors); return res.end('unauthorized');
        }
        const reply = (status, body, headers = {}) => { res.writeHead(status, { ...cors, ...headers }); res.end(body); };
        const body = () => new Promise((resolve) => {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => resolve(Buffer.concat(chunks)));
        });
        const p = (req.url || '').split('?')[0];
        if (!p.startsWith('/store/me/')) return reply(404, 'not found');
        const sub = p.slice('/store/me'.length);

        if (sub === '/refs') {
            if (req.method === 'GET') {
                return store.refs
                    ? reply(200, store.refs, { ETag: `"v${store.refsEtag}"`, 'Content-Type': 'application/octet-stream' })
                    : reply(404, 'no refs');
            }
            if (req.method === 'PUT') {
                if (req.headers['if-none-match'] === '*' && store.refs) return reply(412, 'exists');
                if (req.headers['if-match'] && req.headers['if-match'] !== `"v${store.refsEtag}"`) return reply(412, 'etag mismatch');
                store.refs = await body(); store.refsEtag++;
                return reply(204);
            }
        }
        if (sub === '/packs' && req.method === 'GET') {
            const list = [...store.packs.entries()].map(([n, bytes]) => ({ n: Number(n), size: bytes.length, lastModified: 0 }));
            return reply(200, JSON.stringify(list), { 'Content-Type': 'application/json' });
        }
        const packMatch = sub.match(/^\/packs\/(\d+)$/);
        if (packMatch) {
            const n = packMatch[1];
            if (req.method === 'GET') {
                return store.packs.has(n) ? reply(200, store.packs.get(n), { 'Content-Type': 'application/octet-stream' }) : reply(404, 'no pack');
            }
            if (req.method === 'PUT') {
                if (store.packs.has(n)) return reply(412, 'exists');
                store.packs.set(n, await body());
                return reply(204);
            }
            if (req.method === 'DELETE') { store.packs.delete(n); return reply(204); }
        }
        const wrapMatch = sub.match(/^\/keys\/([0-9a-f]{32,64})$/);
        if (wrapMatch) {
            const id = wrapMatch[1];
            if (req.method === 'GET') {
                return store.keys.has(id) ? reply(200, store.keys.get(id), { 'Content-Type': 'application/octet-stream' }) : reply(404, 'no wrap');
            }
            if (req.method === 'PUT') {
                if (store.keys.has(id)) return reply(412, 'wrap exists');
                store.keys.set(id, await body());
                return reply(204);
            }
        }
        reply(404, 'not found ' + p);
    }).listen(STORE_PORT);
}

// ---- app server: public_html + /sw.js (module wrapper over the library src) ----
function startAppServer() {
    return http.createServer((req, res) => {
        const urlPath = (req.url || '/').split('?')[0];
        if (urlPath === '/test.html') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end('<!doctype html><html><head><meta charset="utf-8"></head><body>encrypted sync test</body></html>');
        }
        if (urlPath === '/sw.js') {
            // In production this is the library's bundled dist/sw.js served by the
            // gateway; a module SW can equally import the unbundled source.
            res.writeHead(200, { 'Content-Type': 'application/javascript' });
            return res.end("import './egs/src/service-worker/sw.js';\n");
        }
        const root = urlPath.startsWith('/egs/') ? EGS_ROOT : APP_ROOT;
        const rel = urlPath.startsWith('/egs/') ? urlPath.slice('/egs'.length) : urlPath;
        const fp = path.join(root, rel);
        if (!fp.startsWith(root)) { res.writeHead(403); return res.end(); }
        fs.readFile(fp, (err, data) => {
            if (err) { res.writeHead(404); return res.end('nf ' + urlPath); }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
            res.end(data);
        });
    }).listen(APP_PORT);
}

const storeServer = startStoreServer();
const appServer = startAppServer();
await new Promise((r) => setTimeout(r, 300));

const browser = await chromium.launch();
async function newAppPage() {
    const ctx = await browser.newContext();
    await ctx.addInitScript(({ storeOrigin, token, account }) => {
        localStorage.setItem('ariz_gateway_host_override', storeOrigin);
        localStorage.setItem('ariz_encrypted_sync_enabled', 'true');
        localStorage.setItem('ariz_gateway_access_token',
            JSON.stringify({ token, accountId: account, issuedAt: Date.now() }));
    }, { storeOrigin: STORE_ORIGIN, token: TOKEN, account: ACCOUNT });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${APP_ORIGIN}/test.html`);
    return { ctx, page, errors };
}

const results = [];

// ---- Device 1: enable → first-time SW registration → init/commit/push ----
{
    const { ctx, page, errors } = await newAppPage();
    const out = await page.evaluate(async (account) => {
        const log = [];
        const step = async (name, fn) => { try { const r = await fn(); log.push('ok:' + name); return r; } catch (e) { log.push('FAIL:' + name + ':' + String(e?.stack ?? e)); throw e; } };
        try {
            const gs = await import('/storage/gitstorage.js'); // git worker starts UNCONTROLLED
            const { fakeWallet } = await import('/arizgateway/encryptionkey.mock.js');
            fakeWallet(account);
            const sp = await import('/storage/storage-page.component.js');
            const controlledBefore = !!navigator.serviceWorker.controller;
            const url = await step('prepareSyncRemote', () => sp.prepareSyncRemote());
            await step('configure_user', () => gs.configure_user({ accessToken: 'irrelevant-for-egit', username: account, useremail: account }));
            await step('writeFile', () => gs.writeFile('report.txt', 'encrypted hello'));
            await step('git_init', () => gs.git_init());
            await step('set_remote', () => gs.set_remote(url));
            await step('commit_all', () => gs.commit_all());
            await step('push', () => gs.push());
            return { ok: true, url, controlledBefore, controlledAfter: !!navigator.serviceWorker.controller, log };
        } catch (e) { return { ok: false, log, error: String(e?.stack ?? e) }; }
    }, ACCOUNT);
    await ctx.close();
    results.push({ name: 'device 1: first-time enable + encrypted push', out, errors });
}

// ---- store at rest: ciphertext only, key wrap present, all requests authed ----
const blobs = [store.refs, ...store.packs.values()].filter(Boolean);
const atRest = {
    refsExists: !!store.refs,
    packCount: store.packs.size,
    wrapCount: store.keys.size,
    allEncrypted: blobs.every((b) => b.subarray(0, 4).equals(EGS_MAGIC)),
    noPlaintext: blobs.every((b) => !b.includes(Buffer.from('PACK')) && !b.includes(Buffer.from('refs/heads')) && !b.includes(Buffer.from('encrypted hello'))),
    badAuthRequests: store.badAuthRequests,
};
results.push({ name: 'store at rest', atRest });

// ---- Device 2: fresh context, same wallet — unlock via wrap, clone, read ----
{
    const { ctx, page, errors } = await newAppPage();
    const out = await page.evaluate(async (account) => {
        const log = [];
        const step = async (name, fn) => { try { const r = await fn(); log.push('ok:' + name); return r; } catch (e) { log.push('FAIL:' + name + ':' + String(e?.stack ?? e)); throw e; } };
        try {
            const gs = await import('/storage/gitstorage.js');
            const { fakeWallet } = await import('/arizgateway/encryptionkey.mock.js');
            fakeWallet(account);
            const sp = await import('/storage/storage-page.component.js');
            const url = await step('prepareSyncRemote', () => sp.prepareSyncRemote());
            await step('configure_user', () => gs.configure_user({ accessToken: 'irrelevant-for-egit', username: account, useremail: account }));
            await step('git_clone', () => gs.git_clone(url));
            const readback = await step('readTextFile', () => gs.readTextFile('report.txt'));
            return { ok: true, readback, log };
        } catch (e) { return { ok: false, log, error: String(e?.stack ?? e) }; }
    }, ACCOUNT);
    await ctx.close();
    results.push({ name: 'device 2: unlock via stored wrap + clone', out, errors });
}

await browser.close();
storeServer.close();
appServer.close();

console.log('\n===== ENCRYPTED SYNC RESULTS =====');
console.log(JSON.stringify(results, null, 2));

const [d1, rest, d2] = results;
const pass =
    d1.out.ok && d1.out.log.includes('ok:push') &&
    d1.out.controlledBefore === false && d1.out.controlledAfter === true &&
    d1.out.url === `${APP_ORIGIN}/egit/${ACCOUNT}` &&
    rest.atRest.refsExists && rest.atRest.packCount >= 1 && rest.atRest.wrapCount === 1 &&
    rest.atRest.allEncrypted && rest.atRest.noPlaintext && rest.atRest.badAuthRequests.length === 0 &&
    d2.out.ok && d2.out.readback === 'encrypted hello' &&
    d1.errors.length === 0 && d2.errors.length === 0;
console.log('\n===== ' + (pass ? 'PASS' : 'FAIL') + ' =====');
process.exit(pass ? 0 : 1);
