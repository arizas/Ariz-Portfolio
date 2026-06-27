import { writeFile } from 'fs/promises';

// arizportfolio.near.page redirects to the gateway-hosted frontend. The gateway
// (an Express server) can set the cross-origin isolation headers the OPFS-based
// wasm-git build needs; web4 serves with fixed headers and can't. The redirect is
// client-side so the path/query/hash are preserved (deep links keep working), and
// it's reversible - point this back at the inlined bundle to undo.
const target = process.env.WEB4_REDIRECT_TARGET ?? 'https://arizgateway.fly.dev';

const redirectHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ariz Portfolio</title>
<script>location.replace(${JSON.stringify(target)} + location.pathname + location.search + location.hash);</script>
</head>
<body>Redirecting to <a href="${target}">${target.replace(/^https?:\/\//, '')}</a>…</body>
</html>`;

const base64Body = Buffer.from(redirectHtml).toString('base64');

const web4json = {
    contentType: "text/html; charset=UTF-8",
    body: base64Body
};

const web4jsonstring = JSON.stringify(web4json);

// Calculate number of 64KB memory pages needed (each page = 65536 bytes)
const memoryPages = Math.ceil(web4jsonstring.length / 65536);

await writeFile(new URL('web4contract.wat', import.meta.url), `
(module
    (import "env" "value_return" (func $value_return (param i64 i64)))
    (func (export "web4_get")
      i64.const ${web4jsonstring.length}
      i64.const 0
      call $value_return
    )
    (memory ${memoryPages})
    (data (i32.const 0) "${web4jsonstring.replace(/\\/g, "\\\\").replace(/\"/g,"\\\"")}")
)`);
