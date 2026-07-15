// PoC: NEAR Intents confidential history via the 1Click API (issue #75).
//
// Proves the full flow: NEP-413 signature -> POST /v0/auth/authenticate -> JWT
// session -> GET /v0/account/history incl. CONFIDENTIAL_INTENTS. Two modes:
//
//  WALLET MODE (default, no secrets):
//      node scripts/intents-history-poc.mjs
//    Starts http://localhost:8123 — open it, connect your wallet (near-connect,
//    same selector as the app: browser wallets or the HOT mobile QR flow) and
//    approve one signature. The script then authenticates and prints your
//    history in this terminal. The private key never leaves the wallet.
//
//  KEY MODE (headless):
//      NEAR_ACCOUNT_ID=<account> NEAR_PRIVATE_KEY=ed25519:<base58> \
//        node scripts/intents-history-poc.mjs
//
// Options: --all (all history, not just confidential), --json [file].
// 1CLICK_API_KEY (or ONECLICK_API_KEY) comes from .env or the environment;
// ONECLICK_API_URL overrides the base URL. Secrets are never printed.
// Auth/nonce scheme mirrors NEAR-DevHub/trezu nt-be/examples/check_confidential_balance.rs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';

// ---- config -------------------------------------------------------------------
const env = { ...Object.fromEntries(
    (fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '')
        .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
), ...process.env };

const API_KEY = env.ONECLICK_API_KEY ?? env['1CLICK_API_KEY'];
const BASE = env.ONECLICK_API_URL ?? 'https://1click.chaindefuser.com';
const RPC = env.NEAR_RPC_URL ?? 'https://rpc.mainnet.fastnear.com';
if (!API_KEY) exit('missing 1CLICK_API_KEY / ONECLICK_API_KEY (in .env or env)');

function exit(msg) { console.error('error:', msg); process.exit(1); }

// ---- base58 ---------------------------------------------------------------------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58decode(s) {
    let n = 0n;
    for (const c of s) {
        const i = B58.indexOf(c);
        if (i < 0) exit('invalid base58');
        n = n * 58n + BigInt(i);
    }
    let hex = n.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    const body = Buffer.from(hex, 'hex');
    let zeros = 0;
    for (const c of s) { if (c === '1') zeros++; else break; }
    return Buffer.concat([Buffer.alloc(zeros), body]);
}
function b58encode(buf) {
    let n = BigInt('0x' + buf.toString('hex'));
    let out = '';
    while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
    for (const b of buf) { if (b === 0) out = '1' + out; else break; }
    return out;
}

// ---- NEP-413 payload / salt / nonce ----------------------------------------------
function serializeNep413({ message, nonce, recipient }) {
    const str = (s) => { const b = Buffer.from(s, 'utf8'); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return [l, b]; };
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32LE((1 << 31) + 413 >>> 0);
    return Buffer.concat([prefix, ...str(message), nonce, ...str(recipient), Buffer.from([0])]);
}
async function fetchSalt() {
    const res = await fetch(RPC, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'query',
            params: {
                request_type: 'call_function', finality: 'optimistic',
                account_id: 'intents.near', method_name: 'current_salt',
                args_base64: Buffer.from('{}').toString('base64'),
            },
        }),
    });
    const json = await res.json();
    if (!json.result?.result) exit('salt query failed: ' + JSON.stringify(json).slice(0, 200));
    const hex = Buffer.from(json.result.result).toString('utf8').replace(/"/g, '');
    return Buffer.from(hex, 'hex'); // 4 bytes
}
function buildNonce(salt, deadlineMs) {
    const nonce = Buffer.alloc(32);
    Buffer.from([0x56, 0x28, 0xF6, 0xC6]).copy(nonce, 0);
    nonce[4] = 0;
    salt.copy(nonce, 5);
    nonce.writeBigUInt64LE(BigInt(deadlineMs) * 1_000_000n, 9);
    nonce.writeBigUInt64LE(BigInt(Date.now()) * 1_000_000n, 17);
    crypto.randomFillSync(nonce, 25, 7);
    return nonce;
}
async function buildAuthPayload(accountId) {
    const salt = await fetchSalt();
    const deadline = new Date(Date.now() + 10 * 60_000);
    const deadlineStr = deadline.toISOString().replace(/(\.\d{3})\d*Z$/, '$1Z');
    const nonce = buildNonce(salt, deadline.getTime());
    // Key order matters: the signature covers this exact string.
    const message = JSON.stringify({ deadline: deadlineStr, intents: [], signer_id: accountId });
    return { message, nonce, recipient: 'intents.near' };
}

// ---- 1Click API -------------------------------------------------------------------
async function api(path, { method = 'GET', body, bearer } = {}) {
    const headers = { 'x-api-key': API_KEY };
    if (body) headers['content-type'] = 'application/json';
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    const res = await fetch(BASE + path, { method, headers, body: body && JSON.stringify(body) });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
    return { status: res.status, json };
}

async function authenticate({ message, nonce, recipient, publicKeyStr, signatureStr }) {
    const auth = await api('/v0/auth/authenticate', {
        method: 'POST',
        body: {
            signedData: {
                standard: 'nep413',
                payload: { message, nonce: nonce.toString('base64'), recipient },
                public_key: publicKeyStr,
                signature: signatureStr,
            },
        },
    });
    if (auth.status !== 200 && auth.status !== 201) {
        throw new Error(`authenticate -> ${auth.status}: ${JSON.stringify(auth.json).slice(0, 300)}`);
    }
    console.log(`authenticated ✓ (access token expires in ${auth.json.expiresIn}s, refresh in ${auth.json.refreshExpiresIn}s)`);
    return auth.json.accessToken;
}

async function fetchAndPrintHistory(bearer) {
    const confidentialOnly = !process.argv.includes('--all');
    const filter = confidentialOnly
        ? '&depositType=CONFIDENTIAL_INTENTS&recipientType=CONFIDENTIAL_INTENTS'
        : '';
    const items = [];
    let cursor = null;
    for (let page = 0; page < 100; page++) {
        const q = `/v0/account/history?limit=20${filter}${cursor ? `&nextCursor=${encodeURIComponent(cursor)}` : ''}`;
        // The 1Click backend occasionally 500s ("AMQP Request failed") — retry
        // with backoff before giving up.
        let last;
        for (let attempt = 0; attempt < 5; attempt++) {
            last = await api(q, { bearer });
            if (last.status < 500) break;
            console.log(`  (server ${last.status} on page ${page}, retry ${attempt + 1}…)`);
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
        const { status, json } = last;
        if (status !== 200) throw new Error(`history -> ${status}: ${JSON.stringify(json).slice(0, 300)}`);
        items.push(...(json.items ?? []));
        cursor = json.nextCursor;
        if (!cursor || (json.items ?? []).length === 0) break;
    }

    console.log(`\n${confidentialOnly ? 'CONFIDENTIAL' : 'ALL'} history: ${items.length} item(s)\n`);
    for (const it of items) {
        console.log([
            (it.createdAt ?? '').slice(0, 19),
            (it.status ?? '').padEnd(9),
            `${it.amountInFormatted ?? '?'} ${(it.originAsset ?? '').split(':').pop()}`.padEnd(28),
            '->',
            `${it.amountOutFormatted ?? '?'} ${(it.destinationAsset ?? '').split(':').pop()}`.padEnd(28),
            `[${it.depositType ?? '?'} -> ${it.recipientType ?? '?'}]`,
        ].join(' '));
    }

    const jsonFlag = process.argv.indexOf('--json');
    if (jsonFlag !== -1) {
        const out = process.argv[jsonFlag + 1] && !process.argv[jsonFlag + 1].startsWith('--')
            ? process.argv[jsonFlag + 1] : 'intents-history.json';
        fs.writeFileSync(out, JSON.stringify(items, null, 1));
        console.log(`\nwrote ${items.length} items to ${out}`);
    }
    return items.length;
}

// ==== KEY MODE ====================================================================
if (env.NEAR_PRIVATE_KEY && env.NEAR_ACCOUNT_ID) {
    const rawKey = b58decode(env.NEAR_PRIVATE_KEY.replace(/^ed25519:/, ''));
    const seed = rawKey.subarray(0, 32);
    const privKeyObj = crypto.createPrivateKey({
        format: 'der', type: 'pkcs8',
        key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    });
    const pubDer = crypto.createPublicKey(privKeyObj).export({ format: 'der', type: 'spki' });
    const publicKeyStr = 'ed25519:' + b58encode(pubDer.subarray(-32));

    console.log(`authenticating as ${env.NEAR_ACCOUNT_ID} (pk ${publicKeyStr.slice(0, 16)}…) against ${BASE}`);
    const payload = await buildAuthPayload(env.NEAR_ACCOUNT_ID);
    const digest = crypto.createHash('sha256').update(serializeNep413(payload)).digest();
    const signatureStr = 'ed25519:' + b58encode(crypto.sign(null, digest, privKeyObj));
    const bearer = await authenticate({ ...payload, publicKeyStr, signatureStr }).catch((e) => exit(e.message));
    await fetchAndPrintHistory(bearer).catch((e) => exit(e.message));
    process.exit(0);
}

// ==== WALLET MODE =================================================================
// Local page signs with the user's wallet (near-connect: extension wallets or the
// HOT mobile QR flow) and posts the signature back; the key never leaves the wallet.
const PAGE = /*html*/ `<!doctype html><html><head><meta charset="utf-8"><title>Intents history PoC — sign in</title>
<style>body{font-family:system-ui;max-width:640px;margin:3em auto;padding:0 1em}button{font-size:1.2em;padding:.5em 1.5em}pre{background:#f4f4f4;padding:1em;white-space:pre-wrap;word-break:break-all}</style>
</head><body>
<h2>NEAR Intents confidential history — PoC</h2>
<p>Connect your wallet and approve <b>one NEP-413 signature</b> (recipient <code>intents.near</code>).
The signature is sent only to the local PoC script, which authenticates against the 1Click API
and prints your history <b>in the terminal</b>.</p>
<button id="go">Connect wallet &amp; sign</button>
<pre id="out"></pre>
<script type="module">
const out = document.getElementById('out');
const log = (s) => { out.textContent += s + '\\n'; };
document.getElementById('go').onclick = async () => {
  try {
    const { NearConnector } = await import('https://esm.sh/@hot-labs/near-connect@0.11.4');
    const connector = new NearConnector({ network: 'mainnet' });
    await connector.connect();
    const wallet = await connector.wallet();
    const [{ accountId }] = await wallet.getAccounts();
    log('connected as ' + accountId);
    const p = await (await fetch('/payload?account=' + encodeURIComponent(accountId))).json();
    log('signing…');
    const nonce = Uint8Array.from(atob(p.nonce), (c) => c.charCodeAt(0));
    const signed = await wallet.signMessage({ message: p.message, recipient: p.recipient, nonce });
    log('signature received from wallet, handing to the PoC script…');
    const res = await (await fetch('/signed', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: signed.accountId ?? accountId, publicKey: signed.publicKey,
                             signature: signed.signature, message: p.message, nonce: p.nonce }),
    })).json();
    log(JSON.stringify(res, null, 2));
    log('Done — see the terminal for the full history table.');
  } catch (e) { log('error: ' + (e && e.message || e)); }
};
</script></body></html>`;

const pending = new Map(); // nonce(b64) -> payload
let lastBearer = null; // access token from the latest auth — lets /retry rerun without re-signing
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
        if (url.pathname === '/') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            return res.end(PAGE);
        }
        if (url.pathname === '/payload') {
            const accountId = url.searchParams.get('account');
            const payload = await buildAuthPayload(accountId);
            pending.set(payload.nonce.toString('base64'), payload);
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ message: payload.message, nonce: payload.nonce.toString('base64'), recipient: payload.recipient }));
        }
        if (url.pathname === '/signed' && req.method === 'POST') {
            const chunks = [];
            for await (const c of req) chunks.push(c);
            const { accountId, publicKey, signature, message, nonce } = JSON.parse(Buffer.concat(chunks).toString());
            const payload = pending.get(nonce);
            if (!payload || payload.message !== message) throw new Error('unknown/expired payload');
            // NEP-413 wallets return the signature base64-encoded; the API wants ed25519:<base58>.
            const signatureStr = 'ed25519:' + b58encode(Buffer.from(signature, 'base64'));
            console.log(`\nwallet signature received for ${accountId} (pk ${publicKey.slice(0, 16)}…)`);
            const bearer = await authenticate({ ...payload, publicKeyStr: publicKey, signatureStr });
            lastBearer = bearer;
            const count = await fetchAndPrintHistory(bearer);
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ ok: true, account: accountId, items: count, note: 'full table printed in the terminal' }));
        }
        if (url.pathname === '/retry') {
            if (!lastBearer) throw new Error('no session yet — sign first');
            const count = await fetchAndPrintHistory(lastBearer);
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ ok: true, items: count, note: 'full table printed in the terminal' }));
        }
        if (url.pathname === '/query') {
            // Single-page probe with arbitrary history filters — for bisecting
            // server-side 500s without burning wallet signatures.
            if (!lastBearer) throw new Error('no session yet — sign first');
            const { status, json } = await api(`/v0/account/history?${url.searchParams.toString()}`, { bearer: lastBearer });
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ status, count: json.items?.length, nextCursor: json.nextCursor ?? null, items: json.items ?? json }));
        }
        res.writeHead(404); res.end('nf');
    } catch (e) {
        console.error('error:', e.message);
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
    }
});
server.listen(8123, () => {
    console.log(`wallet mode (no NEAR_PRIVATE_KEY set) against ${BASE}`);
    console.log('open http://localhost:8123 — connect your wallet and approve one signature.');
    console.log('(ctrl-c to stop)');
});
