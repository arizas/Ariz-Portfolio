// Which tokens the year report leaves out. The list lives in the store
// (getTokenExclusions); this is what changes it.

import { getTokenExclusions, setTokenExclusions } from '../storage/domainobjectstore.js';

/** Whether a token is on the list. Matched by contract, or by symbol for an entry that has none. */
export function isExcluded(exclusions, contractId, symbol) {
    return exclusions.excluded.some(t => t.contractId ? t.contractId === contractId : t.symbol === symbol);
}

/** Leave a token out. Taking it out of `kept` too: the user changed their mind. */
export async function excludeToken({ contractId, symbol }, reason) {
    const exclusions = await getTokenExclusions();
    if (!isExcluded(exclusions, contractId, symbol)) {
        exclusions.excluded.push({ contractId, symbol, ...(reason ? { reason } : {}) });
    }
    exclusions.kept = exclusions.kept.filter(id => id !== contractId);
    await setTokenExclusions(exclusions);
    return exclusions;
}

/** Put a token back, and remember that, so it is not excluded automatically again. */
export async function includeToken(contractId) {
    const exclusions = await getTokenExclusions();
    exclusions.excluded = exclusions.excluded.filter(t => t.contractId !== contractId);
    if (!exclusions.kept.includes(contractId)) exclusions.kept.push(contractId);
    await setTokenExclusions(exclusions);
    return exclusions;
}

/**
 * Exclude the tokens the gateway knows have no price, except any the user put
 * back. Returns the ones added. Never decided from a missing price history: a
 * gateway that did not answer leaves that empty too, and would take real
 * tokens out of the report.
 */
export async function excludeNoPriceTokens(tokens) {
    const exclusions = await getTokenExclusions();
    const added = tokens.filter(t => !isExcluded(exclusions, t.contractId, t.symbol)
        && !exclusions.kept.includes(t.contractId));
    if (added.length) {
        exclusions.excluded.push(...added.map(({ contractId, symbol }) => ({ contractId, symbol, reason: 'no-price' })));
        await setTokenExclusions(exclusions);
    }
    return added;
}
