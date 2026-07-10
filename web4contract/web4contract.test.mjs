// Local harness for the path-aware web4 WAT contract: instantiates the wasm with
// mocked NEAR host functions (input register + value_return) and asserts the
// bodyUrl for the request shapes the web4 gateway sends. Run before any deploy:
//   node web4contract/web4contract.wat.js && node --test web4contract/web4contract.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const wasmBytes = await readFile(new URL('./web4contract.wasm', import.meta.url));
const GATEWAY = 'https://arizgateway.fly.dev';

// One fresh instance per call (the contract is stateless, but keep tests isolated).
async function web4Get(argsJson) {
    let inputBytes = new TextEncoder().encode(argsJson);
    let returned = null;
    let memory; // assigned after instantiate; host fns run only during the call
    const env = {
        input: (_registerId) => {},
        register_len: (_registerId) => BigInt(inputBytes.length),
        read_register: (_registerId, ptr) => {
            new Uint8Array(memory.buffer).set(inputBytes, Number(ptr));
        },
        value_return: (len, ptr) => {
            returned = new TextDecoder().decode(
                new Uint8Array(memory.buffer).slice(Number(ptr), Number(ptr) + Number(len)));
        },
    };
    const { instance } = await WebAssembly.instantiate(wasmBytes, { env });
    memory = instance.exports.memory;
    instance.exports.web4_get();
    return returned;
}

// The request shape the web4 gateway sends (per the web4 spec / observed panics
// from the previous Rust contract wanting a `request` wrapper).
const gatewayArgs = (path) => JSON.stringify({
    request: { accountId: null, path, params: {}, query: {}, preloads: null },
});

describe('path-aware web4 contract', () => {
    test('root', async () => {
        assert.equal(await web4Get(gatewayArgs('/')), `{"bodyUrl":"${GATEWAY}/"}`);
    });

    test('service worker path (the reason for this contract)', async () => {
        assert.equal(await web4Get(gatewayArgs('/sw.js')), `{"bodyUrl":"${GATEWAY}/sw.js"}`);
    });

    test('SPA route', async () => {
        assert.equal(await web4Get(gatewayArgs('/portfolio')), `{"bodyUrl":"${GATEWAY}/portfolio"}`);
    });

    test('nested path with extension', async () => {
        assert.equal(await web4Get(gatewayArgs('/assets/app.css')), `{"bodyUrl":"${GATEWAY}/assets/app.css"}`);
    });

    test('key order does not matter (path last)', async () => {
        const args = JSON.stringify({ request: { query: {}, path: '/x.js' } });
        assert.equal(await web4Get(args), `{"bodyUrl":"${GATEWAY}/x.js"}`);
    });

    test('no path -> falls back to /', async () => {
        assert.equal(await web4Get('{}'), `{"bodyUrl":"${GATEWAY}/"}`);
    });

    test('empty input -> falls back to /', async () => {
        assert.equal(await web4Get(''), `{"bodyUrl":"${GATEWAY}/"}`);
    });

    test('oversized path is truncated, output stays valid JSON', async () => {
        const out = await web4Get(gatewayArgs('/' + 'a'.repeat(10_000)));
        const parsed = JSON.parse(out); // must not corrupt framing
        assert.ok(parsed.bodyUrl.startsWith(`${GATEWAY}/aaa`));
        assert.ok(out.length < 3000, 'output capped before the pattern region');
    });

    test('oversized input (register bigger than memory headroom) -> falls back to /', async () => {
        const big = JSON.stringify({ request: { path: '/x', pad: 'p'.repeat(70_000) } });
        assert.equal(await web4Get(big), `{"bodyUrl":"${GATEWAY}/"}`);
    });
});
