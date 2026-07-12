// Harness for the OPFS git worker (public_html/storage/wasmgitworker.js), driven
// through gitstorage.js in a headless browser served NON cross-origin isolated
// (like web4), against a local git remote. Covers: init, writeFile (OPFS persist),
// git init/commit/first-push, persistence across reload, exportzip, deletelocal,
// and IDBFS->OPFS migration on startup. Exits non-zero on failure (for CI).
//
//   node test_servers/opfs-worker-harness.mjs
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execFile, execSync } from 'child_process';
import { promisify } from 'util';
import cgi from 'cgi';
import { chromium } from '@playwright/test';

const pexec = promisify(execFile);
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public_html');
const GIT_PORT = 8099, APP_PORT = 8086;
const ORIGIN = `http://localhost:${APP_PORT}`;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css' };

let bareRepo;
function startGitBackend() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ow-git-'));
    bareRepo = path.join(root, 'portfolio.git'); // must match the push URL /portfolio.git
    execSync(`git init --bare --initial-branch=master ${bareRepo}`);
    execSync(`git -C ${bareRepo} config http.receivepack true`);
    const gitcgi = cgi('git', { args: ['http-backend'], stderr: process.stderr,
        env: { GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1', REMOTE_USER: 'test@example.com' } });
    return http.createServer((req, res) => {
        const p = req.url.substring(1);
        if (p.includes('git-upload') || p.includes('git-receive')) gitcgi(req, res);
        else { res.statusCode = 404; res.end('nf'); }
    }).listen(GIT_PORT);
}
function startAppServer() {
    return http.createServer((req, res) => {
        const urlPath = (req.url || '/').split('?')[0];
        if (urlPath === '/test.html') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<!doctype html><html><head><meta charset="utf-8"></head><body>opfs worker test</body></html>');
            return;
        }
        if (/\.git\//.test(urlPath)) {
            const proxy = http.request({ hostname: 'localhost', port: GIT_PORT, path: req.url, method: req.method, headers: req.headers },
                (pr) => { res.writeHead(pr.statusCode, pr.headers); pr.pipe(res); });
            proxy.on('error', (e) => { res.writeHead(502); res.end('' + e); });
            req.pipe(proxy);
            return;
        }
        const fp = path.join(APP_ROOT, urlPath);
        fs.readFile(fp, (err, data) => {
            if (err) { res.writeHead(404); res.end('nf ' + urlPath); return; }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
            res.end(data);
        });
    }).listen(APP_PORT);
}

const git = startGitBackend();
const app = startAppServer();
await new Promise((r) => setTimeout(r, 300));

const results = [];
const browser = await chromium.launch();

// ---- Test A: fresh store -> init, write, commit, first-push, persist, zip, delete ----
{
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${ORIGIN}/test.html`);

    const out = await page.evaluate(async (origin) => {
        const gs = await import('/storage/gitstorage.js');
        const log = [];
        const step = async (name, fn) => { try { const r = await fn(); log.push('ok:' + name); return r; } catch (e) { log.push('FAIL:' + name + ':' + String(e)); throw e; } };
        try {
            await step('configure_user', () => gs.configure_user({ accessToken: 'ANON', username: 'Test', useremail: 't@e' }));
            await step('writeFile', () => gs.writeFile('report.txt', 'hello from opfs worker'));
            await step('git_init', () => gs.git_init());
            await step('set_remote', () => gs.set_remote(origin + '/portfolio.git'));
            await step('commit_all', () => gs.commit_all());
            await step('push', () => gs.push());
            return { ok: true, log, readback: await gs.readTextFile('report.txt') };
        } catch (e) { return { ok: false, log, error: String(e) }; }
    }, ORIGIN);

    await page.reload(); // persistence: fresh worker, same OPFS origin
    const persisted = await page.evaluate(async () => {
        const gs = await import('/storage/gitstorage.js');
        try { return { exists: await gs.exists('.git'), readback: await gs.readTextFile('report.txt') }; }
        catch (e) { return { error: String(e) }; }
    });

    const zipcheck = await page.evaluate(async () => {
        const gs = await import('/storage/gitstorage.js');
        try {
            const url = await gs.exportZip();
            const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
            const isZip = buf[0] === 0x50 && buf[1] === 0x4b; // 'PK'
            const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
            const names = Object.keys((await JSZip.loadAsync(buf)).files);
            return { isZip, hasReport: names.some((n) => n.endsWith('report.txt')) };
        } catch (e) { return { error: String(e) }; }
    });

    const delcheck = await page.evaluate(async () => {
        const gs = await import('/storage/gitstorage.js');
        try { await gs.delete_local(); return { afterExists: await gs.exists('.git') }; }
        catch (e) { return { error: String(e) }; }
    });

    await ctx.close();
    results.push({ name: 'A: init/write/commit/first-push + persist + zip + delete', out, persisted, zipcheck, delcheck, errors });
}

// ---- Test B: legacy IDBFS present -> migrated into OPFS on startup ----
{
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${ORIGIN}/test.html`);

    await page.evaluate(async () => {
        await new Promise((resolve, reject) => {
            const req = indexedDB.open('/nearearningsdata', 21);
            req.onupgradeneeded = () => req.result.createObjectStore('FILE_DATA').createIndex('timestamp', 'timestamp');
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction('FILE_DATA', 'readwrite');
                const s = tx.objectStore('FILE_DATA');
                s.put({ timestamp: new Date(), mode: 0o040000 | 0o777 }, '/nearearningsdata');
                s.put({ timestamp: new Date(), mode: 0o100000 | 0o666, contents: new TextEncoder().encode('{"legacy":true}') }, '/nearearningsdata/legacy.json');
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onerror = () => reject(tx.error);
            };
            req.onerror = () => reject(req.error);
        });
    });

    const migrated = await page.evaluate(async () => {
        const gs = await import('/storage/gitstorage.js');
        try { return { readback: await gs.readTextFile('legacy.json') }; }
        catch (e) { return { error: String(e) }; }
    });

    await ctx.close();
    results.push({ name: 'B: IDBFS -> OPFS migration on startup', migrated, errors });
}

// ---- Test C: repo migrated WITHOUT .git/objects/pack (empty dirs are lost in
// the IDBFS->OPFS migration) must still be able to fetch — libgit2 cannot
// create the pack dir itself, so a downloaded pack silently never got indexed
// ("target OID for the reference doesn't exist"; diagnosed from a real user
// repo). The worker now recreates the dir; this guards that.
{
    const fsp = await import('node:fs/promises');
    const os = await import('node:os');
    const pathm = await import('node:path');
    const root = await fsp.mkdtemp(pathm.join(os.tmpdir(), 'ow-legacy-'));
    const run = (cwd, ...args) => pexec('git', ['-C', cwd, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });

    // Upstream bare repo (served by the same git backend) with commits c1 + c2.
    const legacyBare = pathm.join(pathm.dirname(bareRepo), 'legacy.git');
    await pexec('git', ['init', '--bare', '--initial-branch=master', legacyBare]);
    await pexec('git', ['--git-dir=' + legacyBare, 'config', 'http.receivepack', 'true']);
    const work = pathm.join(root, 'work');
    await fsp.mkdir(work);
    await run(work, 'init', '-b', 'master');
    await fsp.writeFile(pathm.join(work, 'a.txt'), 'first\n');
    await run(work, 'add', '.'); await run(work, 'commit', '-m', 'c1');
    await run(work, 'push', legacyBare, 'master');
    const edit = pathm.join(root, 'edit');
    await run(root, 'clone', '-q', legacyBare, 'edit');
    await fsp.writeFile(pathm.join(edit, 'b.txt'), 'second, from another device\n');
    await run(edit, 'add', '.'); await run(edit, 'commit', '-m', 'c2');
    await run(edit, 'push', '-q');

    // The device's local repo is at c1 with a LOOSE odb and NO objects/pack dir
    // (the migration-lost shape).
    await fsp.rm(pathm.join(work, '.git/objects/pack'), { recursive: true, force: true });

    // Collect the repo's files for import into OPFS.
    const files = [];
    const walk = async (dir) => {
        for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
            const p = pathm.join(dir, e.name);
            if (e.isDirectory()) await walk(p);
            else files.push({ rel: pathm.relative(work, p), b64: (await fsp.readFile(p)).toString('base64') });
        }
    };
    await walk(work);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${ORIGIN}/test.html`);

    const out = await page.evaluate(async ({ entries, url }) => {
        const gs = await import('/storage/gitstorage.js');
        try {
            const dirs = [...new Set(entries.map((f) => f.rel.split('/').slice(0, -1).join('/')).filter(Boolean))]
                .sort((a, b) => a.split('/').length - b.split('/').length);
            for (const d of dirs) { try { await gs.mkdir(d); } catch { } }
            for (const { rel, b64 } of entries) {
                await gs.writeFile(rel, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
            }
            await gs.configure_user({ accessToken: 'ANON', username: 't', useremail: 't@t' });
            await gs.set_remote(url);
            await gs.sync();
            return { ok: true, readback: await gs.readTextFile('b.txt') };
        } catch (e) { return { ok: false, error: String(e).slice(0, 400) }; }
    }, { entries: files, url: `${ORIGIN}/legacy.git` });

    await ctx.close();
    results.push({ name: 'C: fetch into migrated repo without .git/objects/pack', out, errors });
}

await browser.close();
git.close();
app.close();

let remoteRefs = '', remoteFile = '';
try { remoteRefs = (await pexec('git', ['--git-dir=' + bareRepo, 'for-each-ref'])).stdout.trim(); } catch (e) { remoteRefs = 'ERR ' + (e.stderr || e.message); }
try { remoteFile = (await pexec('git', ['--git-dir=' + bareRepo, 'show', 'master:report.txt'])).stdout.trim(); } catch (e) { remoteFile = 'ERR ' + (e.stderr || e.message); }

console.log('\n===== OPFS WORKER RESULTS =====');
console.log(JSON.stringify(results, null, 2));
console.log('remote refs:', JSON.stringify(remoteRefs), '\nremote report.txt =', JSON.stringify(remoteFile));

const A = results[0], B = results[1], C = results[2];
const pass =
    A.out.ok && A.out.readback === 'hello from opfs worker' && A.out.log.includes('ok:push') &&
    remoteRefs.includes('refs/heads/master') &&
    A.persisted.exists === true && A.persisted.readback === 'hello from opfs worker' &&
    A.zipcheck.isZip === true && A.zipcheck.hasReport === true &&
    A.delcheck.afterExists === false &&
    remoteFile === 'hello from opfs worker' &&
    B.migrated.readback === '{"legacy":true}' &&
    C.out.ok && C.out.readback === 'second, from another device\n' &&
    A.errors.length === 0 && B.errors.length === 0 && C.errors.length === 0;
console.log('\n===== ' + (pass ? 'PASS' : 'FAIL') + ' =====');
process.exit(pass ? 0 : 1);
