// Whether the stored files can be read at all, and which accounts have data.
//
// The domain store's getters answer "what does this file say", and a file they
// cannot parse makes them throw without saying which one. This answers the
// question they cannot: it reports each known file by its state, never its
// content, so the report is safe to hand to anything that may not read the files.

import { exists, readTextFile, readdir } from './gitstorage.js';
import { hasConflictMarkers } from './jsonmerge.js';
import { accountdatadir, accountsconfigfile, pricedatadir } from './domainobjectstore.js';

const isArray = Array.isArray;
const isPlainObject = (value) => value !== null && typeof value === 'object' && !isArray(value);

// One rule per known file. `rows` says how many entries a readable file holds.
const ACCOUNT_FILES = {
    'transactions.json': { shape: isArray, expected: 'an array', rows: (d) => d.length },
    'fungible_token_transactions.json': { shape: isArray, expected: 'an array', rows: (d) => d.length },
    'records.json': { shape: (d) => isArray(d?.records), expected: 'an object with a records array', rows: (d) => d.records.length },
    'confidential_intents_history.json': { shape: isArray, expected: 'an array', rows: (d) => d.length },
};
const POOL_FILE = { shape: isArray, expected: 'an array', rows: (d) => d.length };
const PRICE_FILE = { shape: isPlainObject, expected: 'an object', rows: (d) => Object.keys(d).length };
const ACCOUNTS_FILE = { shape: isArray, expected: 'an array', rows: (d) => d.length };

// A listing includes . and .., and .. is the store's root.
const list = async (dir) => (await exists(dir)) ? (await readdir(dir)).filter((name) => !name.startsWith('.')) : [];

async function checkFile(path, rule) {
    const text = await readTextFile(path);
    const bytes = text.length;
    if (hasConflictMarkers(text)) return { path, bytes, status: 'conflict-markers' };
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        return { path, bytes, status: 'unparseable' };
    }
    if (!rule.shape(data)) return { path, bytes, status: 'wrong-shape', expected: rule.expected };
    return { path, bytes, status: 'ok', rows: rule.rows(data) };
}

/**
 * @returns {Promise<{checked: number, problems: object[], accounts: object[],
 *   accountsWithoutData: string[], dataWithoutAccount: string[]}>}
 */
export async function checkStoreFiles() {
    const results = [];

    let trackedAccounts = [];
    if (await exists(accountsconfigfile)) {
        const result = await checkFile(accountsconfigfile, ACCOUNTS_FILE);
        results.push(result);
        if (result.status === 'ok') trackedAccounts = JSON.parse(await readTextFile(accountsconfigfile));
    } else {
        results.push({ path: accountsconfigfile, status: 'missing' });
    }

    const accountDirs = await list(accountdatadir);
    const accounts = [];
    for (const account of accountDirs) {
        const files = {};
        for (const [name, rule] of Object.entries(ACCOUNT_FILES)) {
            const path = `${accountdatadir}/${account}/${name}`;
            if (!(await exists(path))) continue;
            const result = await checkFile(path, rule);
            results.push(result);
            files[name] = result.status === 'ok' ? result.rows : result.status;
        }
        for (const name of await list(`${accountdatadir}/${account}/stakingpools`)) {
            const path = `${accountdatadir}/${account}/stakingpools/${name}`;
            const result = await checkFile(path, POOL_FILE);
            results.push(result);
            files[`stakingpools/${name}`] = result.status === 'ok' ? result.rows : result.status;
        }
        accounts.push({ account, files });
    }

    for (const token of await list(pricedatadir)) {
        for (const name of await list(`${pricedatadir}/${token}`)) {
            if (name.endsWith('.json')) results.push(await checkFile(`${pricedatadir}/${token}/${name}`, PRICE_FILE));
        }
    }

    return {
        checked: results.length,
        problems: results.filter((result) => result.status !== 'ok'),
        accounts,
        accountsWithoutData: trackedAccounts.filter((account) => !accountDirs.includes(account)),
        dataWithoutAccount: accountDirs.filter((account) => !trackedAccounts.includes(account)),
    };
}
