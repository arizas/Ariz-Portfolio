export const MAX_CALLS_PER_MINUTE = 5;
let lastCountStartTime = new Date().getTime();
let countSinceStartTime = 0;

/**
 * Test seams: the clock, the wait, and the network.
 *
 * What this module does is wait — five calls a minute, then hold until the
 * minute is up. Proving that against the real clock and the real API costs a
 * minute of wall time and can only fail for reasons that are not this code's
 * doing: the test asserting our throttle went red because nearblocks.io was
 * behind a Cloudflare 522.
 */
const realClock = {
    now: () => new Date().getTime(),
    sleep: (millis) => new Promise(resolve => setTimeout(resolve, millis)),
    // Bound through a wrapper: passing `fetch` itself as a default and calling
    // it unbound is an illegal invocation in a browser.
    fetch: (...args) => fetch(...args),
};

/** Test hook: reset the window so one spec's calls do not count against another's. */
export function __resetRateLimit(startTime = new Date().getTime()) {
    lastCountStartTime = startTime;
    countSinceStartTime = 0;
}

export async function getFromNearBlocks(path, clock = realClock) {
    const { now, sleep, fetch: fetchImpl } = { ...realClock, ...clock };
    countSinceStartTime++;
    if (countSinceStartTime > MAX_CALLS_PER_MINUTE) {
        const timeoutMillis = lastCountStartTime + 60_000 - now();
        if (timeoutMillis > 0) {
            await sleep(timeoutMillis);
        }
    }
    // A minute elapsed is a new window, the boundary included. With `<` the
    // window only reopened because setTimeout overshoots its deadline: waiting
    // exactly long enough left the counter above the limit, and every call after
    // that went straight through unthrottled until the clock drifted past.
    if (lastCountStartTime <= (now() - 60_000)) {
        lastCountStartTime = now();
        countSinceStartTime = 0;
    }
    const fetchFunc = async () => await fetchImpl(`https://api.nearblocks.io${path}`, { mode: 'cors' });

    let response = await fetchFunc();
    if (response.status === 429) {
        console.error('too many requests', response, 'retry in 60 seconds');
        await sleep(60_000);
        response = await fetchFunc();
    }

    if (response.status === 200) {
        if (response.headers.get('x-cache-hit') === 'true' && countSinceStartTime > 0) {
            countSinceStartTime--;
        }
        return await response.json();
    } else {
        console.error(response);
        throw new Error(`${response.status}: ${await response.text()}`);
    }
}
