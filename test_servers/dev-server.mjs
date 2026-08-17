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
