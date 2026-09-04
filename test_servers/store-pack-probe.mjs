// Can the REAL browser stack index the packs a store is serving?
//
//   node test_servers/store-pack-probe.mjs <tip-sha> <plaintext-pack>...
//
// Seeds an in-memory store with the given PLAINTEXT packs (encrypted with the
// browser-minted DEK, exactly as production stores them), then runs the app's
// own sync() against it through the real service worker and the real wasm-git.
// Exit 0 = the fetch indexed and the working tree materialised; exit 1 prints
// libgit2's actual complaint.
//
// It answers the question no unit test can: `git index-pack` is not libgit2,
// and the two disagree. A store whose merged pack carries one object twice is
// refused by both, but git names the duplicate while libgit2 may instead fail
// in fix_thin_pack with "no REF_DELTA found, cannot inject object" — which is
// what a real store did on 2026-09-04, matching no error pattern the worker
// looked for.
//
// Getting the plaintext packs out of a live store (read-only) and rebuilding a
// clean one are both in the remote helper: decrypt each `packs/<n>` with the
// repo's egit.key, and `git-remote-egit --gc <url>` to replace them.

import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { chromium } from '@playwright/test';

const APP_ROOT = '/Users/peter/git/Ariz-Portfolio/public_html';
const EGS_ROOT = '/Users/peter/git/Ariz-Portfolio/node_modules/encrypted-git-storage';
const { encrypt, sha256hex } = await import(path.join(EGS_ROOT, 'src/core/crypto.js'));
const { emptyManifest, advanceManifest } = await import(path.join(EGS_ROOT, 'src/core/format.js'));
const { encryptManifest } = await import(path.join(EGS_ROOT, 'src/core/manifest-io.js'));

const [TIP, ...packPaths] = process.argv.slice(2);
const packs = packPaths.map((p) => fs.readFileSync(p));
console.log(`seeding ${packs.length} pack(s), tip ${TIP}`);

const { publicKey: pubObj, privateKey: privObj } = crypto.generateKeyPairSync('ed25519');
const walletPrivateJwk = privObj.export({ format: 'jwk' });
const rawPub = pubObj.export({ type: 'spki', format: 'der' }).subarray(-32);
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58 = (b) => { let n = BigInt('0x' + Buffer.from(b).toString('hex')), o = ''; while (n > 0n) { o = B58[Number(n % 58n)] + o; n /= 58n; } return o; };
const walletPublicKey = 'ed25519:' + b58(rawPub);
function serializeNep413Payload({ message, nonce, recipient, callbackUrl = null }) {
    const enc = new TextEncoder();
    const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
    const str = (s) => { const b = enc.encode(s); return [u32(b.length), b]; };
    const chunks = [u32(2147484061), ...str(message), nonce, ...str(recipient),
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
    const sig = crypto.sign(null, crypto.createHash('sha256').update(payload).digest(), privObj);
    const salt = Buffer.from('ariz-egit-salt-v1');
    return {
        kek: Buffer.from(crypto.hkdfSync('sha256', sig, salt, Buffer.from('ariz-egit-kek-v1'), 32)),
        wrapId: Buffer.from(crypto.hkdfSync('sha256', sig, salt, Buffer.from('ariz-egit-wrap-id-v1'), 16)).toString('hex'),
    };
}
const unwrapDek = (kek, blob) => {
    const d = crypto.createDecipheriv('aes-256-gcm', kek, blob.subarray(0, 12));
    d.setAuthTag(blob.subarray(blob.length - 16));
    return Buffer.concat([d.update(blob.subarray(12, blob.length - 16)), d.final()]);
};

const store = { refs: null, etag: 0, packs: new Map(), keys: new Map() };
const APP_PORT = 8090, STORE_PORT = 8089, APP_ORIGIN = `http://localhost:${APP_PORT}`;
const storeServer = http.createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': APP_ORIGIN, 'Access-Control-Allow-Methods': 'GET,HEAD,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? '*', 'Access-Control-Expose-Headers': 'ETag' };
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
        if (req.method === 'DELETE') { store.packs.delete(pk[1]); return reply(204); }
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
    __setTestWallet({ accountId,
        async getAccounts() { return [{ accountId }]; },
        async signMessage({ message, recipient, nonce }) {
            const payload = serializeNep413Payload({ message, nonce: new Uint8Array(nonce), recipient });
            const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', payload));
            const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', key, digest));
            return { accountId, publicKey: publicKeyStr, signature: btoa(String.fromCharCode(...sig)) };
        },
        async signOut() { } });
}`;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
const appServer = http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0];
    if (urlPath === '/test.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><html><head><meta charset="utf-8"></head><body>pack repro</body></html>'); }
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
    window.__realWalletParams = walletParams;
}, { storeOrigin: `http://localhost:${STORE_PORT}`, walletParams: { accountId: 'repro.near', privateJwk: walletPrivateJwk, publicKeyStr: walletPublicKey } });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { const t = m.text(); logs.push(t); if (/Bad news|duplicate|REF_DELTA|refish|variant/.test(t)) console.log('[browser]', t.split('\n')[0].slice(0, 220)); });
await page.goto(`${APP_ORIGIN}/test.html`);

const { remoteUrl } = await page.evaluate(async () => {
    const { installRealTestWallet } = await import('/realwallet.js');
    await installRealTestWallet(window.__realWalletParams);
    await import('/storage/gitstorage.js');
    const es = await import('/arizgateway/encryptedsync.js');
    return await es.configureEgitKey();
});
const { kek, wrapId } = deriveKekAndWrapId();
const dek = unwrapDek(kek, store.keys.get(wrapId));

let manifest = emptyManifest();
for (let i = 0; i < packs.length; i++) {
    manifest = advanceManifest(manifest, {
        refUpdates: { 'refs/heads/master': TIP },
        pack: { n: i, sha: await sha256hex(packs[i]), size: packs[i].length },
    });
    store.packs.set(String(i), Buffer.from(await encrypt(dek, packs[i])));
}
store.refs = Buffer.from(await encryptManifest(dek, manifest)); store.etag++;
console.log('store seeded — running the app sync (a fetch into an empty repo)');

const out = await page.evaluate(async (remoteUrl) => {
    const gs = await import('/storage/gitstorage.js');
    try {
        await gs.configure_user({ accessToken: 'x', username: 'repro.near', useremail: 'repro.near' });
        await gs.git_init();
        await gs.set_remote(remoteUrl);
        await gs.sync();
        const t = await gs.readTextFile('accountdata/petersalomonsen.near/confidential_intents_history.json').catch(() => null);
        return { ok: true, items: t ? JSON.parse(t).length : null };
    } catch (e) { return { ok: false, error: String(e).slice(0, 900) }; }
}, remoteUrl);

console.log('\nRESULT:', JSON.stringify(out, null, 1));
await browser.close(); storeServer.close(); appServer.close();
process.exit(out.ok ? 0 : 1);
