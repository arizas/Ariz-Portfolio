// Semantic merging of the store's JSON files.
//
// Every file in the store is a JSON document that two devices append to
// independently: a price history gains today's price, a transactions file gains
// the transactions that happened since the last fetch. Git merges TEXT, and the
// tail of a JSON document is the one place two independent appends always
// collide - the last entry's line changes ("x": 1 -> "x": 1,) on both sides. So
// concurrent use of two devices conflicts on essentially every file, every time,
// and git's answer is a file with <<<<<<< markers in it: no longer JSON, and
// (because `add .` happily stages it) one more Synchronize away from being
// committed and pushed to every other device. That is exactly what happened to
// sixteen price files on 2026-08-24.
//
// Merging by MEANING instead of by text removes the whole class: two price
// histories are two maps of date -> price, and their merge is the union. This
// module knows the shape of every file the app writes and resolves them without
// asking anyone anything. It is deliberately dependency-free so the git worker
// can import it.

/** A file whose two sides could not be merged (not JSON at all, say). */
export class UnmergeableError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UnmergeableError';
    }
}

const CONFLICT_START = '<<<<<<<';
const CONFLICT_SEPARATOR = '=======';
const CONFLICT_END = '>>>>>>>';

const STARTS_A_CONFLICT = new RegExp(`(^|\\n)${CONFLICT_START} `);
const ENDS_A_CONFLICT = new RegExp(`(^|\\n)${CONFLICT_END} `);

export function hasConflictMarkers(text) {
    return typeof text === 'string' && STARTS_A_CONFLICT.test(text) && ENDS_A_CONFLICT.test(text);
}

/**
 * Recover the two full documents a conflicted file was made of.
 *
 * A conflicted file is not junk: it is both versions, interleaved, with the
 * shared parts written once. Keeping the shared lines and only one side's hunks
 * reconstructs that side line for line - which is what makes a file that was
 * already committed with markers in it (the 2026-08-24 damage) repairable
 * offline, with no access to the commits it came from.
 *
 * @returns {{ours: string, theirs: string}|null} null if there are no markers.
 */
export function splitConflictSides(text) {
    if (!hasConflictMarkers(text)) return null;
    const ours = [];
    const theirs = [];
    let side = 'both';
    for (const line of text.split('\n')) {
        if (side === 'both' && line.startsWith(`${CONFLICT_START} `)) {
            side = 'ours';
        } else if (side === 'ours' && (line === CONFLICT_SEPARATOR || line.startsWith(`${CONFLICT_SEPARATOR} `))) {
            side = 'theirs';
        } else if (side === 'theirs' && line.startsWith(`${CONFLICT_END} `)) {
            side = 'both';
        } else if (side === 'both') {
            ours.push(line);
            theirs.push(line);
        } else if (side === 'ours') {
            ours.push(line);
        } else {
            theirs.push(line);
        }
    }
    return { ours: ours.join('\n'), theirs: theirs.join('\n') };
}

// ---- shape rules ------------------------------------------------------------
//
// What identifies "the same entry" in each array the app writes, and the order
// the file is kept in. Identity is what makes a union safe: without it two
// devices that both fetched the same transaction would each contribute a copy,
// and a duplicated transaction is double-counted money.

const byBlockHeightDesc = (a, b) => (b.block_height ?? 0) - (a.block_height ?? 0);
const byBlockHeightAsc = (a, b) => (a.block_height ?? 0) - (b.block_height ?? 0);
const byCreatedAtAsc = (a, b) => (String(a.createdAt ?? '') < String(b.createdAt ?? '') ? -1 : 1);

const ARRAY_RULES = [
    {
        // accountdata/<account>/transactions.json
        match: (path, at) => at === '' && /(^|\/)transactions\.json$/.test(path),
        id: (tx) => tx.hash,
        sort: byBlockHeightDesc,
    },
    {
        // accountdata/<account>/fungible_token_transactions.json - one hash can
        // carry several tokens, so the contract is part of the identity.
        match: (path, at) => at === '' && /(^|\/)fungible_token_transactions\.json$/.test(path),
        id: (tx) => `${tx.transaction_hash} ${tx.ft?.contract_id ?? ''}`,
        sort: byBlockHeightDesc,
    },
    {
        // accountdata/<account>/stakingpools/<pool>.json - a pool can have a
        // reward snapshot and a principal move at the same height.
        match: (path, at) => at === '' && /\/stakingpools\/[^/]+\.json$/.test(path),
        id: (entry) => `${entry.block_height} ${entry.hash ?? ''}`,
        sort: byBlockHeightDesc,
    },
    {
        // accountdata/<account>/confidential_intents_history.json
        match: (path, at) => at === '' && /(^|\/)confidential_intents_history\.json$/.test(path),
        id: (item) => item.depositAddress ?? item.id ?? null,
        sort: byCreatedAtAsc,
    },
    {
        // accountdata/<account>/records.json -> .records - a balance change is
        // identified by where it happened, not by a field the gateway assigns.
        match: (path, at) => at === 'records' && /(^|\/)records\.json$/.test(path),
        id: (r) => [r.block_height, r.token_id, r.receipt_id, r.tx_hash, r.amount, r.balance_after].join(' '),
        sort: byBlockHeightAsc,
    },
];

// Used when no rule matches - a file this module has not been taught about, or
// a nested array. Tried in order; the first field every element of both sides
// has, uniquely, wins. Falling back to the whole element (canonical, below) is
// always safe but cannot recognise an UPDATED entry as the same entry, so it is
// last.
const GENERIC_ID_FIELDS = ['hash', 'transaction_hash', 'id', 'receipt_id', 'depositAddress'];

function arrayRuleFor(path, at) {
    return ARRAY_RULES.find((rule) => rule.match(path, at)) ?? null;
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Key-order-independent serialization, so identity does not depend on how the writer happened to order keys. */
function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (isPlainObject(value)) {
        return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

function detectIdentity(ours, theirs) {
    const all = [...ours, ...theirs];
    if (all.length === 0 || !all.every(isPlainObject)) return canonical;
    for (const field of GENERIC_ID_FIELDS) {
        if (all.every((item) => item[field] !== undefined && item[field] !== null)
            && [ours, theirs].every((side) => new Set(side.map((i) => i[field])).size === side.length)) {
            return (item) => item[field];
        }
    }
    return canonical;
}

function mergeArrays(ours, theirs, path, at) {
    const rule = arrayRuleFor(path, at);
    let identity = rule ? rule.id : detectIdentity(ours, theirs);
    // A rule whose field is missing from the data (an older file, a shape that
    // changed) must not collapse every entry onto the key `undefined`.
    if (rule && [...ours, ...theirs].some((item) => !isPlainObject(item) || identity(item) === undefined || identity(item) === null)) {
        identity = detectIdentity(ours, theirs);
    }

    const merged = new Map();
    for (const item of ours) merged.set(identity(item), item);
    for (const item of theirs) {
        const key = identity(item);
        const existing = merged.get(key);
        // Same entry seen by both devices: merge the two records rather than
        // picking one, so a field only one side has is not dropped.
        merged.set(key, existing !== undefined && isPlainObject(existing) && isPlainObject(item)
            ? mergeValues(existing, item, path, `${at}[]`)
            : item);
    }

    const result = [...merged.values()];
    if (rule?.sort) result.sort(rule.sort);
    return result;
}

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function mergeValues(ours, theirs, path, at = '') {
    if (ours === undefined) return theirs;
    if (theirs === undefined) return ours;
    if (Array.isArray(ours) && Array.isArray(theirs)) return mergeArrays(ours, theirs, path, at);
    if (isPlainObject(ours) && isPlainObject(theirs)) {
        const merged = {};
        for (const key of Object.keys(ours)) merged[key] = ours[key];
        for (const key of Object.keys(theirs)) {
            merged[key] = key in merged
                ? mergeValues(merged[key], theirs[key], path, at ? `${at}.${key}` : key)
                : theirs[key];
        }
        // A map keyed by date (every price history is one) is kept in date order
        // so the file has ONE canonical form. Two devices that fetched the same
        // days in a different order then produce the same bytes, and the next
        // merge has less to disagree about.
        const keys = Object.keys(merged);
        if (keys.length > 1 && keys.every((k) => ISO_DATE.test(k))) {
            const sorted = {};
            for (const key of keys.sort()) sorted[key] = merged[key];
            return sorted;
        }
        return merged;
    }
    // Two timestamps for the same thing: the later one describes both.
    if (typeof ours === 'string' && typeof theirs === 'string' && ISO_DATE_TIME.test(ours) && ISO_DATE_TIME.test(theirs)) {
        return ours > theirs ? ours : theirs;
    }
    // Anything else (two prices for the same day, two spellings of a setting):
    // the remote wins. It is arbitrary but it is DETERMINISTIC - every device
    // resolving the same pair the same way is what makes the stores converge.
    return theirs;
}

/**
 * The store's files are written with JSON.stringify(value, null, 1) - except a
 * few small ones written compactly. Re-serializing with the wrong indent would
 * rewrite every line of the file and turn the next sync into a whole-file
 * conflict, so the indent is read back off the side we were given.
 */
function detectIndent(text) {
    if (typeof text !== 'string') return 1;
    const match = /^[[{]\n( *)\S/.exec(text);
    if (!match) return text.includes('\n') ? 1 : 0;
    return Math.min(match[1].length, 4);
}

/**
 * Parse one side, repairing it first if it arrives with conflict markers in it
 * (the store already carries such a commit - see the module comment).
 */
function parseSide(path, text) {
    if (text === null || text === undefined) return { missing: true };
    if (hasConflictMarkers(text)) {
        const { ours, theirs } = splitConflictSides(text);
        const a = parseSide(path, ours);
        const b = parseSide(path, theirs);
        if (a.missing) return b;
        if (b.missing) return a;
        return { value: mergeValues(a.value, b.value, path) };
    }
    if (text.trim() === '') return { missing: true };
    try {
        return { value: JSON.parse(text) };
    } catch (e) {
        throw new UnmergeableError(`${path}: not valid JSON (${e.message})`);
    }
}

// records.json carries a summary of the records it holds. Merging the two
// summaries field by field would leave it describing neither side's file, so it
// is recomputed from the merged records instead.
function fixupRecordsMetadata(value) {
    if (!isPlainObject(value) || !Array.isArray(value.records) || !isPlainObject(value.metadata)) return value;
    const heights = value.records.map((r) => r.block_height).filter((h) => typeof h === 'number');
    value.metadata = {
        ...value.metadata,
        ...(heights.length ? { firstBlock: Math.min(...heights), lastBlock: Math.max(...heights) } : {}),
        totalRecords: value.records.length,
    };
    return value;
}

/**
 * Merge two versions of one of the store's files.
 *
 * @param {string} path repository-relative path - selects the shape rules.
 * @param {string|null} oursText this device's version (null: only the other side has the file).
 * @param {string|null} theirsText the remote's version.
 * @returns {string} the merged file's text.
 * @throws {UnmergeableError} if a side is not JSON and so has no meaning to merge.
 */
export function mergeJsonText(path, oursText, theirsText) {
    if (oursText === theirsText && oursText !== null && oursText !== undefined) return oursText;
    const ours = parseSide(path, oursText);
    const theirs = parseSide(path, theirsText);
    if (ours.missing && theirs.missing) throw new UnmergeableError(`${path}: neither side has any content`);

    const indent = detectIndent(ours.missing ? theirsText : oursText);
    if (ours.missing) return JSON.stringify(theirs.value, null, indent);
    if (theirs.missing) return JSON.stringify(ours.value, null, indent);

    const merged = fixupRecordsMetadata(mergeValues(ours.value, theirs.value, path));
    return JSON.stringify(merged, null, indent);
}

/**
 * Repair a single file that was committed with conflict markers in it, using
 * only the file itself. Returns the text unchanged when there is nothing wrong.
 */
export function repairConflictedText(path, text) {
    if (!hasConflictMarkers(text)) return text;
    const { ours, theirs } = splitConflictSides(text);
    return mergeJsonText(path, ours, theirs);
}
