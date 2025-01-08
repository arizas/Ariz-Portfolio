export const MAX_CALLS_PER_MINUTE = 5;
let lastCountStartTime = new Date().getTime();
let countSinceStartTime = 0;

export async function getFromNearBlocks(path) {
    countSinceStartTime++;
    if (countSinceStartTime > MAX_CALLS_PER_MINUTE) {
        const timeoutMillis = lastCountStartTime + 60_000 - new Date().getTime();
        if (timeoutMillis > 0) {
            await new Promise(resolve => setTimeout(() => resolve(), timeoutMillis));
        }
    }
    if (lastCountStartTime < (new Date().getTime() - 60_000)) {
        lastCountStartTime = new Date().getTime();
        countSinceStartTime = 0;
    }

    let response = await fetch(`https://api.nearblocks.io${path}`, { mode: 'cors' });
    if (response.status === 429) {
        throw new Error(`Too many requests to nearblocks. Try again after a minute.\n${response.status}: ${await response.text()}`);
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