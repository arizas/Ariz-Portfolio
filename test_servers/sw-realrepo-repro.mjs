// ULTIMATE-fidelity repro: browser 1's ACTUAL repository (from the user's zip
// export, .git and all) imported into OPFS, syncing against a store holding the
// EXACT production packs, through the REAL service worker + key flow.
//
//   node test_servers/sw-realrepo-repro.mjs <repoDir> <prod-pack0> <prod-pack1> <OLD> <NEW>
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public_html');
const EGS_ROOT = path.resolve(APP_ROOT, '../node_modules/encrypted-git-storage');
const { encrypt, sha256hex } = await import(path.join(EGS_ROOT, 'src/core/crypto.js'));
const { emptyManifest, advanceManifest } = await import(path.join(EGS_ROOT, 'src/core/format.js'));
const { encryptManifest } = await import(path.join(EGS_ROOT, 'src/core/manifest-io.js'));

const [repoDir, pack0Path, pack1Path, OLD, NEW] = process.argv.slice(2);
const pack0 = fs.readFileSync(pack0Path);
const pack1 = fs.readFileSync(pack1Path);

// ---- wallet key + node-side derivation mirror (as in sw-prod-bytes-repro) ----
const { publicKey: walletPubObj, privateKey: walletPrivObj } = crypto.generateKeyPairSync('ed25519');
const walletPrivateJwk = walletPrivObj.export({ format: 'jwk' });
const walletRawPub = walletPubObj.export({ type: 'spki', format: 'der' }).subarray(-32);
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58encode = (bytes) => {
    let n = BigInt('0x' + Buffer.from(bytes).toString('hex')); let out = '';
    while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
    for (const b of bytes) { if (b === 0) out = '1' + out; else break; }
    return out;
};
const walletPublicKey = 'ed25519:' + b58encode(walletRawPub);
function serializeNep413Payload({ message, nonce, recipient, callbackUrl = null }) {
    const enc = new TextEncoder();
    const u32le = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
    const str = (s) => { const b = enc.encode(s); return [u32le(b.length), b]; };
    const chunks = [u32le(2147484061), ...str(message), nonce, ...str(recipient),
        ...(callbackUrl == null ? [new Uint8Array([0])] : [new Uint8Array([1]), ...str(callbackUrl)])];
    const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let off = 0; for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
}
const DERIVATION_MESSAGE = 'Unlock your encrypted Ariz Portfolio storage.\n\n'
    + 'Signing this message derives the key that protects your synced data. '
    + 'Only sign it on arizportfolio.near.page or a client you trust.';
function deriveKekAndWrapId() {
    const payload = serializeNep413Payload({
        message: DERIVATION_MESSAGE,
        nonce: new TextEncoder().encode('ariz-encrypted-storage-nonce-v1!'),
        recipient: 'encrypted-storage.arizportfolio.near',
    });
    const digest = crypto.createHash('sha256').update(payload).digest();
    const sig = crypto.sign(null, digest, walletPrivObj);
    const salt = Buffer.from('ariz-egit-salt-v1');
    return {
        kek: Buffer.from(crypto.hkdfSync('sha256', sig, salt, Buffer.from('ariz-egit-kek-v1'), 32)),
        wrapId: Buffer.from(crypto.hkdfSync('sha256', sig, salt, Buffer.from('ariz-egit-wrap-id-v1'), 16)).toString('hex'),
    };
}
function unwrapDek(kek, blob) {
    const iv = blob.subarray(0, 12), ct = blob.subarray(12, blob.length - 16), tag = blob.subarray(blob.length - 16);
    const d = crypto.createDecipheriv('aes-256-gcm', kek, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
}

// ---- in-memory store ----------------------------------------------------------
const store = { refs: null, etag: 0, packs: new Map(), keys: new Map() };
const APP_PORT = 8090, STORE_PORT = 8089;
const APP_ORIGIN = `http://localhost:${APP_PORT}`;
http.createServer(async (req, res) => {
    const cors = {
        'Access-Control-Allow-Origin': APP_ORIGIN,
        'Access-Control-Allow-Methods': 'GET,HEAD,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? '*',
        'Access-Control-Expose-Headers': 'ETag',
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const reply = (s, b, h = {}) => { res.writeHead(s, { ...cors, ...h }); res.end(b); };
    const body = () => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
    const sub = (req.url || '').split('?')[0].replace(/^\/store\/me/, '');
    if (sub === '/refs') {
        if (req.method === 'GET') return store.refs ? reply(200, store.refs, { ETag: `"v${store.etag}"` }) : reply(404, 'no refs');
        if (req.method === 'PUT') { store.refs = await body(); store.etag++; return reply(204); }
    }
    const pk = sub.match(/^\/packs\/(\d+)$/);
    if (pk) {
        if (req.method === 'GET') return store.packs.has(pk[1]) ? reply(200, store.packs.get(pk[1])) : reply(404, 'no pack');
        if (req.method === 'PUT') { store.packs.set(pk[1], await body()); return reply(204); }
    }
    if (sub === '/packs') return reply(200, JSON.stringify([...store.packs.entries()].map(([n, b]) => ({ n: Number(n), size: b.length, lastModified: 0 }))));
    const wr = sub.match(/^\/keys\/([0-9a-f]{32,64})$/);
    if (wr) {
        if (req.method === 'GET') return store.keys.has(wr[1]) ? reply(200, store.keys.get(wr[1])) : reply(404, 'no wrap');
        if (req.method === 'PUT') { store.keys.set(wr[1], await body()); return reply(204); }
    }
    reply(404, 'nf ' + sub);
}).listen(STORE_PORT);

const realWalletModule = `
const serializeNep413Payload = ${serializeNep413Payload.toString()};
export async function installRealTestWallet({ accountId, privateJwk, publicKeyStr }) {
    const { __setTestWallet } = await import('/arizgateway/arizgatewayaccess.js');
    const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'Ed25519' }, false, ['sign']);
    __setTestWallet({
        accountId,
        async getAccounts() { return [{ accountId }]; },
        async signMessage({ message, recipient, nonce }) {
            const payload = serializeNep413Payload({ message, nonce: new Uint8Array(nonce), recipient });
            const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', payload));
            const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', key, digest));
            return { accountId, publicKey: publicKeyStr, signature: btoa(String.fromCharCode(...sig)) };
        },
        async signOut() { },
    });
}
`;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0];
    if (urlPath === '/test.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><html><head><meta charset="utf-8"></head><body>real repo repro</body></html>'); }
    if (urlPath === '/sw.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end("import './egs/src/service-worker/sw.js';\n"); }
    if (urlPath === '/realwallet.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(realWalletModule); }
    const root = urlPath.startsWith('/egs/') ? EGS_ROOT : APP_ROOT;
    const rel = urlPath.startsWith('/egs/') ? urlPath.slice('/egs'.length) : urlPath;
    fs.readFile(path.join(root, rel), (err, data) => {
        if (err) { res.writeHead(404); return res.end('nf'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream' });
        res.end(data);
    });
}).listen(APP_PORT);

const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addInitScript(({ storeOrigin, walletParams }) => {
    localStorage.setItem('ariz_gateway_host_override', storeOrigin);
    localStorage.setItem('ariz_encrypted_sync_enabled', 'true');
    window.__realWalletParams = walletParams;
}, { storeOrigin: `http://localhost:${STORE_PORT}`, walletParams: { accountId: 'repro.near', privateJwk: walletPrivateJwk, publicKeyStr: walletPublicKey } });
const page = await ctx.newPage();
page.on('console', (m) => { const t = m.text(); if (/variant|Bad news|target OID|refish|Error|EOF|index|Failed/.test(t)) console.log('[browser]', t.split('\n')[0].slice(0, 200)); });
await page.goto(`${APP_ORIGIN}/test.html`);

// Phase 0: SW + key setup (browser mints DEK; node unwraps it for store seeding).
const { remoteUrl } = await page.evaluate(async () => {
    const { installRealTestWallet } = await import('/realwallet.js');
    await installRealTestWallet(window.__realWalletParams);
    await import('/storage/gitstorage.js');
    const es = await import('/arizgateway/encryptedsync.js');
    return await es.configureEgitKey();
});
const { kek, wrapId } = deriveKekAndWrapId();
const dek = unwrapDek(kek, store.keys.get(wrapId));
console.log('DEK unwrapped; seeding store with PRODUCTION packs');

const m1 = advanceManifest(emptyManifest(), { refUpdates: { 'refs/heads/master': OLD }, pack: { n: 0, sha: await sha256hex(pack0), size: pack0.length } });
const m2 = advanceManifest(m1, { refUpdates: { 'refs/heads/master': NEW }, pack: { n: 1, sha: await sha256hex(pack1), size: pack1.length } });
store.refs = Buffer.from(await encryptManifest(dek, m2)); store.etag++;
store.packs.set('0', Buffer.from(await encrypt(dek, pack0)));
store.packs.set('1', Buffer.from(await encrypt(dek, pack1)));

// Phase 1: import browser 1's ACTUAL repo (incl. .git) into OPFS.
const files = [];
(function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else files.push(p);
    }
})(repoDir);
// Ablation: SKIP=<regex> drops matching repo-relative paths from the import.
const skip = process.env.SKIP ? new RegExp(process.env.SKIP) : null;
const kept = skip ? files.filter((f) => !skip.test(path.relative(repoDir, f))) : [...files];
if (skip) console.log(`SKIP=${process.env.SKIP}: importing ${kept.length}/${files.length} files`);
files.length = 0; files.push(...kept);
console.log(`importing ${files.length} files into OPFS…`);
const dirs = [...new Set(files.map((f) => path.dirname(path.relative(repoDir, f))).filter((d) => d && d !== '.'))]
    .sort((a, b) => a.split('/').length - b.split('/').length);
if (process.env.ADD_DIRS) dirs.push(...process.env.ADD_DIRS.split(','));
await page.evaluate(async (dirList) => {
    const gs = await import('/storage/gitstorage.js');
    for (const d of dirList) { try { await gs.mkdir(d); } catch { } }
}, dirs);
for (let i = 0; i < files.length; i += 40) {
    const batch = files.slice(i, i + 40).map((f) => ({ rel: path.relative(repoDir, f), b64: fs.readFileSync(f).toString('base64') }));
    await page.evaluate(async (entries) => {
        const gs = await import('/storage/gitstorage.js');
        for (const { rel, b64 } of entries) {
            const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            await gs.writeFile(rel, bytes);
        }
    }, batch);
}
console.log('repo imported');

// Phase 2: browser 1's failing step — the app's sync flow.
const out = await page.evaluate(async (remoteUrl) => {
    const gs = await import('/storage/gitstorage.js');
    try {
        await gs.configure_user({ accessToken: 'x', username: 'repro.near', useremail: 'repro.near' });
        await gs.set_remote(remoteUrl);
        await gs.sync();
        const t = await gs.readTextFile('accountdata/petersalomonsen.near/records.json').catch(() => null);
        return { ok: true, gotB: t !== null };
    } catch (e) { return { ok: false, error: String(e).slice(0, 700) }; }
}, remoteUrl);
console.log('sync with REAL browser-1 repo:', JSON.stringify(out, null, 1));

await browser.close();
console.log(out.ok ? '===== NOT REPRODUCED =====' : '===== REPRODUCED =====');
process.exit(out.ok ? 1 : 0);
