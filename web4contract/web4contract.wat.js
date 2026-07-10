import { writeFile } from 'fs/promises';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

// Minimal web4 contract for arizportfolio.near — PATH-AWARE bodyUrl.
//
// web4_get extracts `path` from the request JSON and returns
//   {"bodyUrl":"<GATEWAY><path>"}
// so the NEAR web4 gateway (*.near.page) fetches each path from the Ariz gateway
// server-side and serves it under the arizportfolio.near.page origin:
//   /            -> gateway /            -> index.html (the app bundle)
//   /portfolio   -> gateway /portfolio   -> index.html (gateway SPA fallback)
//   /sw.js       -> gateway /sw.js       -> the service worker, served as
//                                           application/javascript (required for
//                                           navigator.serviceWorker.register)
//
// The per-path bodyUrl is what makes same-origin assets like the encrypted-git
// service worker possible (a SW must be same-origin with a JS MIME type); the
// previous fixed-bodyUrl contract served index.html for every path.
//
// Implementation: scan the input JSON for the first `"path":"` and copy the
// string value (up to the next '"') onto the URL prefix. If no path is found,
// fall back to "/". Written as raw WAT (~0.6 KB wasm) to keep storage staking
// minimal. Memory layout:
//   0..     output buffer (starts with the URL prefix from the data segment)
//   3000..  the 8-byte pattern `"path":"`
//   4096..  the request JSON (copied from the input register)
//
// Override the target with WEB4_BODY_URL when building for a different gateway
// (no trailing slash — the request path always starts with one).
const BODY_URL = (process.env.WEB4_BODY_URL || 'https://arizgateway.fly.dev').replace(/\/$/, '');

const PREFIX = `{"bodyUrl":"${BODY_URL}`;
const PREFIX_LEN = PREFIX.length;
const PATTERN = '"path":"';
const OUT_BASE = 0;
const PATTERN_BASE = 3000;
const INPUT_BASE = 4096;
// Stop copying before the pattern/input areas so a pathological path can't
// overwrite the region we're still reading from.
const OUT_MAX = PATTERN_BASE - 8;

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const wat = `(module
    (import "env" "input" (func $input (param i64)))
    (import "env" "register_len" (func $register_len (param i64) (result i64)))
    (import "env" "read_register" (func $read_register (param i64 i64)))
    (import "env" "value_return" (func $value_return (param i64 i64)))
    (memory (export "memory") 1)
    (data (i32.const ${OUT_BASE}) "${esc(PREFIX)}")
    (data (i32.const ${PATTERN_BASE}) "${esc(PATTERN)}")
    (func (export "web4_get")
        (local $inLen i32) (local $i i32) (local $j i32) (local $out i32) (local $c i32)

        ;; Copy the request JSON from the input register into memory at INPUT_BASE.
        (call $input (i64.const 0))
        (local.set $inLen (i32.wrap_i64 (call $register_len (i64.const 0))))
        ;; Cap absurd inputs so read_register can never write past the memory page
        ;; (the web4 gateway sends small JSON; anything bigger just gets "/").
        (if (i32.gt_s (local.get $inLen) (i32.const ${65536 - INPUT_BASE}))
            (then (local.set $inLen (i32.const 0)))
            (else (call $read_register (i64.const 0) (i64.const ${INPUT_BASE}))))

        (local.set $out (i32.const ${PREFIX_LEN}))
        (local.set $i (i32.const 0))

        (block $notfound
            (loop $scan
                (br_if $notfound (i32.gt_s (i32.add (local.get $i) (i32.const ${PATTERN.length})) (local.get $inLen)))
                (block $nomatch
                    ;; compare PATTERN.length bytes at INPUT_BASE+i with the pattern
                    (local.set $j (i32.const 0))
                    (loop $cmp
                        (br_if $nomatch (i32.ne
                            (i32.load8_u (i32.add (i32.add (i32.const ${INPUT_BASE}) (local.get $i)) (local.get $j)))
                            (i32.load8_u (i32.add (i32.const ${PATTERN_BASE}) (local.get $j)))))
                        (local.set $j (i32.add (local.get $j) (i32.const 1)))
                        (br_if $cmp (i32.lt_s (local.get $j) (i32.const ${PATTERN.length})))
                    )
                    ;; matched: copy the path value until the closing quote
                    (local.set $i (i32.add (local.get $i) (i32.const ${PATTERN.length})))
                    (block $donecopy
                        (loop $copy
                            (br_if $donecopy (i32.ge_s (local.get $i) (local.get $inLen)))
                            (local.set $c (i32.load8_u (i32.add (i32.const ${INPUT_BASE}) (local.get $i))))
                            (br_if $donecopy (i32.eq (local.get $c) (i32.const 34))) ;; '"'
                            (br_if $donecopy (i32.ge_s (local.get $out) (i32.const ${OUT_MAX})))
                            (i32.store8 (local.get $out) (local.get $c))
                            (local.set $out (i32.add (local.get $out) (i32.const 1)))
                            (local.set $i (i32.add (local.get $i) (i32.const 1)))
                            (br $copy)
                        )
                    )
                    ;; close the JSON: '"' '}' and return
                    (i32.store8 (local.get $out) (i32.const 34))
                    (i32.store8 (i32.add (local.get $out) (i32.const 1)) (i32.const 125))
                    (call $value_return
                        (i64.extend_i32_u (i32.add (local.get $out) (i32.const 2)))
                        (i64.const ${OUT_BASE}))
                    (return)
                )
                (local.set $i (i32.add (local.get $i) (i32.const 1)))
                (br $scan)
            )
        )
        ;; no "path":" found — default to "/"
        (i32.store8 (i32.const ${PREFIX_LEN}) (i32.const 47))      ;; '/'
        (i32.store8 (i32.const ${PREFIX_LEN + 1}) (i32.const 34))  ;; '"'
        (i32.store8 (i32.const ${PREFIX_LEN + 2}) (i32.const 125)) ;; '}'
        (call $value_return (i64.const ${PREFIX_LEN + 3}) (i64.const ${OUT_BASE}))
    )
)
`;

const watPath = fileURLToPath(new URL('web4contract.wat', import.meta.url));
const wasmPath = fileURLToPath(new URL('web4contract.wasm', import.meta.url));

await writeFile(watPath, wat);
execFileSync('wat2wasm', [watPath, '-o', wasmPath]);

console.log(`web4_get -> {"bodyUrl":"${BODY_URL}<path>"} (path-aware)`);
console.log(`built ${wasmPath}`);
