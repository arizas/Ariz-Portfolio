// Serves the built bundle (dist/index.html) the way the Ariz gateway does: a
// fresh Content-Security-Policy nonce in place of the placeholder on every
// request, /sw.js beside it, and every other path answered with the page.
//
// The dev server serves public_html unbundled and with no policy, so it cannot
// show what the policy blocks. This can: run `yarn dist && yarn serve:dist`
// and watch the console for "Refused to …".
//
// Port 8081 by default, like the dev server — the gateway allows that origin,
// and it is where a local store already lives. Stop the dev server first.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CSP_NONCE_PLACEHOLDER } from '../csp.js';

const INDEX = fileURLToPath(new URL('../dist/index.html', import.meta.url));
const SW_PATH = fileURLToPath(new URL('../node_modules/encrypted-git-storage/dist/sw.js', import.meta.url));
const PORT = Number(process.env.PORT ?? 8081);

createServer(async (req, res) => {
    try {
        if (new URL(req.url, 'http://x').pathname === '/sw.js') {
            res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
            res.end(await readFile(SW_PATH));
            return;
        }
        // Standard base64: the wallet connector strips anything else from it.
        const nonce = randomBytes(18).toString('base64');
        const html = (await readFile(INDEX, 'utf8')).replaceAll(CSP_NONCE_PLACEHOLDER, nonce);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(html);
    } catch (e) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(String(e));
    }
}).listen(PORT, () => console.log(`dist preview with CSP on http://localhost:${PORT}`));
