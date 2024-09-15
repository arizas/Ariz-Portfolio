export const MAX_CALLS_PER_MINUTE = 6;
let lastCountStartTime = new Date().getTime();
let countSinceStartTime = 0;

export async function getFromNearBlocks(path) {
    countSinceStartTime++;
    if (countSinceStartTime >= MAX_CALLS_PER_MINUTE) {
        const timeoutMillis = lastCountStartTime + 60_000 - new Date().getTime();
        if (timeoutMillis > 0) {
            await new Promise(resolve => setTimeout(() => resolve(), timeoutMillis));
        }
    }
    if (lastCountStartTime < (new Date().getTime() - 60_000)) {
        lastCountStartTime = new Date().getTime();
        countSinceStartTime = 0;
    }
    const fetchFunc = async () => await fetch(`https://api.nearblocks.io${path}`, { mode: 'cors' });

    let response = await fetchFunc();
    if (response.status === 429) {
        console.error('too many requests', response, 'retry in 60 seconds');
        await new Promise(resolve => setTimeout(() => resolve(), 60_000));
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