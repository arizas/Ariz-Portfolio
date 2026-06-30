import { writeFile } from 'fs/promises';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

// Minimal web4 contract for arizportfolio.near.
//
// web4_get returns a fixed `bodyUrl`, so the NEAR web4 gateway (*.near.page)
// fetches the frontend bundle from the Ariz gateway server-side and serves it
// under the arizportfolio.near.page origin. That keeps the app on .near.page
// (URL unchanged, OPFS/IndexedDB data preserved) - it is NOT a client-side
// redirect to fly.dev.
//
// This replaces the previous ~123 KB Rust contract (whose token-registry methods
// are unused) with a ~0.6 KB wasm that does the one thing still needed, freeing
// ~1.2 NEAR of storage staking. The contract reads no input, so web4_get can
// never panic on a malformed request.
//
// Override the target with WEB4_BODY_URL when building for a different gateway.
const BODY_URL = process.env.WEB4_BODY_URL || 'https://arizgateway.fly.dev/';

const web4jsonstring = JSON.stringify({ bodyUrl: BODY_URL });

// Each wasm memory page is 64 KiB; the body is tiny but keep the math general.
const memoryPages = Math.max(1, Math.ceil(web4jsonstring.length / 65536));

// Escape for a wat data-string literal (backslash and double-quote only).
const escaped = web4jsonstring.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// value_return(value_len, value_ptr): return memory[0 .. len] as the view result.
const wat = `(module
    (import "env" "value_return" (func $value_return (param i64 i64)))
    (func (export "web4_get")
      i64.const ${web4jsonstring.length}
      i64.const 0
      call $value_return
    )
    (memory ${memoryPages})
    (data (i32.const 0) "${escaped}")
)
`;

const watPath = fileURLToPath(new URL('web4contract.wat', import.meta.url));
const wasmPath = fileURLToPath(new URL('web4contract.wasm', import.meta.url));

await writeFile(watPath, wat);
execFileSync('wat2wasm', [watPath, '-o', wasmPath]);

console.log(`web4_get -> ${web4jsonstring} (${web4jsonstring.length} bytes)`);
console.log(`built ${wasmPath}`);
