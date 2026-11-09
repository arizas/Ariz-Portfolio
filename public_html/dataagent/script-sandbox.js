// Runs a script the model wrote in QuickJS compiled to wasm: a separate engine
// with no DOM, network or storage. The one way out is `app.*`, which is whatever
// `api` the caller passes, and every value crossing that boundary is JSON text.
//
// A fresh engine per run, so nothing carries over from one script to the next.

// 0.0.6 or later: from 0.0.6 the engine frees what each host call returned, so a
// script can page through a dataset of any size and only the time limit bounds it.
const QUICKJS_URL = 'https://cdn.jsdelivr.net/npm/quickjs-wasm@0.0.6/js/quickjs.js';

export const SCRIPT_TIMEOUT_MS = 20000;
// The engine's wasm memory is a fixed 16 MB, whatever a limit above that says.
// That bounds what a script holds at once, not what it reads in total.
export const SCRIPT_MEMORY_LIMIT = 15 * 1024 * 1024;
/** What a script may hand back. Anything larger would end up in the model's context. */
export const MAX_SCRIPT_OUTPUT_CHARS = 6000;

let createQuickJSPromise = null;
function loadCreateQuickJS() {
    createQuickJSPromise ??= import(/* @vite-ignore */ QUICKJS_URL).then((module) => module.createQuickJS)
        .catch((error) => {
            createQuickJSPromise = null; // a failed load can be retried
            throw error;
        });
    return createQuickJSPromise;
}

// The guest's whole world. `app.rows` walks a query's pages, so a script can go
// through a dataset far larger than any one answer may be.
const guestSource = (code, methods) => `
const __output = [];
const __text = (value) => (typeof value === 'string' ? value : value === undefined ? 'undefined' : JSON.stringify(value));
globalThis.print = (...values) => { __output.push(values.map(__text).join(' ')); };
globalThis.console = { log: print, info: print, warn: print, error: print };

const __call = async (method, args) => {
    const answer = JSON.parse(await env.callHostAsync({ function_name: 'appCall', method, args: JSON.stringify(args ?? {}) }));
    if (answer.error) throw new Error(answer.error);
    return answer.result;
};
const app = Object.create(null);
for (const method of ${JSON.stringify(methods)}) app[method] = (args) => __call(method, args);
app.rows = async function* (args) {
    let cursor = args?.cursor;
    do {
        const page = await app.query({ ...args, cursor });
        yield* page.rows;
        cursor = page.nextCursor;
    } while (cursor !== null && cursor !== undefined);
};
globalThis.app = Object.freeze(app);

export async function __run() {
    const result = { value: undefined, error: null, output: __output };
    try {
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        const value = await new AsyncFunction(${JSON.stringify(String(code))})();
        result.value = value === undefined ? undefined : __text(value);
    } catch (error) {
        result.error = String((error && error.message) || error);
    }
    return JSON.stringify(result);
}
`;

/**
 * @param {string} code the body of an async function
 * @param {Object<string, function>} api what the script reaches as app.<name>(args)
 * @returns {Promise<{output: string[], value: (string|undefined), error: (string|null)}>}
 */
export async function runScript(code, api, { timeoutMs = SCRIPT_TIMEOUT_MS } = {}) {
    const createQuickJS = await loadCreateQuickJS();
    const quickjs = await createQuickJS();
    quickjs.setMemoryLimit(SCRIPT_MEMORY_LIMIT);

    // The guest names the host function it calls, so that name must not reach
    // anything inherited: a plain object would answer to `constructor`.
    quickjs.hostFunctions = Object.create(null);

    // One deadline for the whole run. A guest resuming after a host call runs
    // outside callModFunction's own window, so it is set again each time.
    const deadline = Date.now() + timeoutMs;
    const arm = () => quickjs.wasmInstance.set_eval_deadline(deadline);

    quickjs.hostFunctions.appCall = async (params) => {
        const method = quickjs.getObjectPropertyValue(params, 'method');
        const argsText = quickjs.getObjectPropertyValue(params, 'args');
        let answerText;
        try {
            if (!Object.hasOwn(api, method)) throw new Error(`app.${method} does not exist`);
            answerText = JSON.stringify({ result: await api[method](JSON.parse(argsText)) });
        } catch (error) {
            answerText = JSON.stringify({ error: String((error && error.message) || error) });
        }
        arm();
        return quickjs.allocateJSstring(answerText);
    };

    const bytecode = quickjs.compileToByteCode(guestSource(code, Object.keys(api)), 'data-agent-script.js');
    const module = quickjs.loadByteCode(bytecode);
    const promise = quickjs.callModFunction(module, '__run', timeoutMs);
    arm();
    try {
        await quickjs.waitForPendingAsyncInvocations();
    } finally {
        quickjs.wasmInstance.clear_interrupt();
    }

    const resultText = quickjs.getPromiseResult(promise);
    if (typeof resultText !== 'string') {
        return { output: [], value: undefined, error: `the script did not finish within ${timeoutMs / 1000}s` };
    }
    const result = JSON.parse(resultText);
    if (result.error && /interrupt/i.test(result.error)) {
        result.error = `the script did not finish within ${timeoutMs / 1000}s and was stopped`;
    }
    return result;
}

const cap = (text) => (text.length > MAX_SCRIPT_OUTPUT_CHARS
    ? `${text.slice(0, MAX_SCRIPT_OUTPUT_CHARS)}\n[${text.length - MAX_SCRIPT_OUTPUT_CHARS} more characters cut: print less]`
    : text);

/** A script's result as the text the model gets, within the output cap. */
export function formatScriptResult({ output, value, error }) {
    const parts = [];
    if (output.length) parts.push(output.join('\n'));
    if (value !== undefined) parts.push(`returned: ${value}`);
    if (error) parts.push(`ERROR: ${error}`);
    return cap(parts.join('\n') || '(the script printed nothing: use print())');
}
