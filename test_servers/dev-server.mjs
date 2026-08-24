// Development server for public_html.
//
// `http-server public_html/` is not enough for the app to actually work, for two
// reasons that only show up once you try to use it rather than just load it:
//
//  1. **/sw.js.** The encrypted sync registers the egit service worker at
//     `<origin>/sw.js` with scope `/` — it is the browser's git-remote-egit, and
//     without it Synchronize fails with "Could not install the encrypted sync
//     service worker … 404". In production that file is served same-origin by
//     the gateway (and via the web4 contract's path-aware bodyUrl), but it lives
//     in the encrypted-git-storage package, not in public_html. A service worker
//     must be same-origin, so no amount of CORS or proxying substitutes for it.
//     It is served straight from node_modules here so it cannot drift from the
//     installed version the way a checked-in copy would.
//
//  2. **SPA routes.** Reloading on /portfolio or /storage has to reach
//     index.html. /storage is also a real directory under public_html, so a
//     plain static server answers it with a directory listing instead.
//
// Usage: `yarn serve` (port 8081, matching ARIZ_STORE_ALLOWED_ORIGINS on the
// gateway, so the frontend can be run against real data).
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../public_html/', import.meta.url));
const SW_PATH = fileURLToPath(new URL('../node_modules/encrypted-git-storage/dist/sw.js', import.meta.url));
const PORT = Number(process.env.PORT ?? 8081);

const TYPES = {
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.map': 'application/json; charset=utf-8',
};
const typeOf = p => TYPES[extname(p).toLowerCase()] ?? 'application/octet-stream';

async function fileOrNull(path) {
    try {
        const s = await stat(path);
        return s.isFile() ? s : null;
    } catch {
        return null;
    }
}

const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = decodeURIComponent(url.pathname);

    // The library's service worker, served same-origin at the root so it can
    // claim scope '/'. Service-Worker-Allowed is belt and braces: the script is
    // already at the root, but it makes the intent explicit.
    if (path === '/sw.js') {
        const sw = await fileOrNull(SW_PATH);
        if (!sw) {
            res.writeHead(500, { 'content-type': 'text/plain' });
            return res.end('encrypted-git-storage/dist/sw.js not found — run `yarn install`');
        }
        res.writeHead(200, {
            'content-type': TYPES['.js'],
            'service-worker-allowed': '/',
            'cache-control': 'no-cache',
        });
        return createReadStream(SW_PATH).pipe(res);
    }

    // Reject traversal before touching the filesystem.
    const resolved = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!resolved.startsWith(ROOT)) {
        res.writeHead(403, { 'content-type': 'text/plain' });
        return res.end('forbidden');
    }

    const direct = await fileOrNull(resolved);
    if (direct) {
        res.writeHead(200, { 'content-type': typeOf(resolved), 'cache-control': 'no-cache' });
        return createReadStream(resolved).pipe(res);
    }

    // /egit/* belongs to the service worker and to nothing else. Falling through
    // to the SPA answer below hands git a page of HTML, whose first four bytes
    // are not a hex length — so a request that merely MISSED the service worker
    // is reported as "bad packet length", which sounds like a corrupt store and
    // sent a whole day's debugging in the wrong direction. Say what happened.
    // It is logged as well as answered: git's transport does not report the
    // status, it just fails to parse whatever body it gets, so the only place
    // the truth is visible is here.
    // The answer is framed as a pkt-line ERR, because git does not report the
    // HTTP status here — it parses whatever body it gets. Plain prose (or the
    // SPA's HTML) is read as a packet length and reported as "bad packet
    // length", which says nothing and sounds like a corrupt store. An ERR frame
    // is valid framing, so git prints the message instead.
    if (path.startsWith('/egit/')) {
        console.log(`[egit MISSED the service worker] ${req.method} ${req.url}`);
        const message = 'ERR this request never reached the egit service worker: it is not registered/activated, or the wasm-git worker predates it\n';
        // The length prefix counts BYTES, so it is measured on the buffer.
        const payload = Buffer.from(message, 'utf8');
        const header = Buffer.from((payload.length + 4).toString(16).padStart(4, '0'), 'ascii');
        res.writeHead(200, { 'content-type': 'application/x-git-upload-pack-result', 'cache-control': 'no-cache' });
        return res.end(Buffer.concat([header, payload]));
    }

    // SPA fallback: client-routed paths, and directories that happen to share a
    // name with a route (public_html/storage/ is both).
    if (req.method === 'GET' || req.method === 'HEAD') {
        const index = await readFile(join(ROOT, 'index.html')).catch(() => null);
        if (index) {
            res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' });
            return res.end(req.method === 'HEAD' ? undefined : index);
        }
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
});

server.listen(PORT, () => {
    console.log(`Ariz Portfolio dev server: http://localhost:${PORT}`);
    console.log(`  public_html/  ->  ${ROOT}`);
    console.log(`  /sw.js        ->  ${SW_PATH}`);
});
