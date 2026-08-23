import { getFromNearBlocks, MAX_CALLS_PER_MINUTE, __resetRateLimit } from "./nearblocks.js";

// nearblocks allows five calls a minute and answers 429 above that, so this
// module holds the sixth back until the minute is up. What follows drives that
// against a clock it controls.
//
// It used to make six real calls to api.nearblocks.io and watch the wall clock,
// which took a minute of every CI run and went red whenever nearblocks was
// having a bad day — a Cloudflare 522, most recently, failing a test about our
// own arithmetic. Nothing in the waiting needs the network to be up.
function fakeClock(startTime = 1_000_000) {
    const slept = [];
    let time = startTime;
    return {
        slept,
        get time() { return time; },
        advance: (millis) => { time += millis; },
        now: () => time,
        sleep: async (millis) => { slept.push(millis); time += millis; },
        fetch: async () => new Response('4242', {
            status: 200, headers: { 'content-type': 'application/json' },
        }),
    };
}

describe('holding to the nearblocks rate limit', () => {
    it('lets a minute of calls straight through', async () => {
        const clock = fakeClock();
        __resetRateLimit(clock.now());
        for (let n = 0; n < MAX_CALLS_PER_MINUTE; n++) {
            expect(await getFromNearBlocks('/v1/blocks/count', clock)).to.equal(4242);
        }
        expect(clock.slept).to.deep.equal([]);
    });

    it('holds the call after them until the minute is up', async () => {
        const clock = fakeClock();
        __resetRateLimit(clock.now());
        for (let n = 0; n < MAX_CALLS_PER_MINUTE; n++) await getFromNearBlocks('/v1/blocks/count', clock);

        clock.advance(15_000);
        await getFromNearBlocks('/v1/blocks/count', clock);
        // Waited out what was left of the minute, not a whole one on top of it.
        expect(clock.slept).to.deep.equal([45_000]);
    });

    // The window has to reopen on the boundary itself. Waiting exactly long
    // enough used to leave the counter above the limit, so everything after the
    // first held call went through unthrottled — the one thing the limit exists
    // to stop — and it only worked at all because setTimeout overshoots.
    it('opens a new window after waiting, rather than staying shut', async () => {
        const clock = fakeClock();
        __resetRateLimit(clock.now());
        for (let n = 0; n <= MAX_CALLS_PER_MINUTE; n++) await getFromNearBlocks('/v1/blocks/count', clock);
        expect(clock.slept).to.deep.equal([60_000]);

        // A fresh minute's worth, none of which should wait.
        for (let n = 0; n < MAX_CALLS_PER_MINUTE; n++) await getFromNearBlocks('/v1/blocks/count', clock);
        expect(clock.slept).to.deep.equal([60_000]);

        // And the one after those is held again.
        await getFromNearBlocks('/v1/blocks/count', clock);
        expect(clock.slept).to.deep.equal([60_000, 60_000]);
    });

    // A cached answer did not cost a call against the quota upstream, so it
    // should not cost one here either.
    it('does not count an answer that came from the cache', async () => {
        const clock = fakeClock();
        __resetRateLimit(clock.now());
        clock.fetch = async () => new Response('4242', {
            status: 200, headers: { 'content-type': 'application/json', 'x-cache-hit': 'true' },
        });
        for (let n = 0; n < MAX_CALLS_PER_MINUTE * 3; n++) await getFromNearBlocks('/v1/blocks/count', clock);
        expect(clock.slept).to.deep.equal([]);
    });

    it('names the status when the call fails', async () => {
        const clock = fakeClock();
        __resetRateLimit(clock.now());
        clock.fetch = async () => new Response('Connection timed out', { status: 522 });
        let thrown;
        try {
            await getFromNearBlocks('/v1/blocks/count', clock);
        } catch (e) {
            thrown = e;
        }
        expect(thrown?.message).to.include('522');
        expect(thrown?.message).to.include('Connection timed out');
    });

    // 429 is the upstream saying the count was wrong. One retry, a minute later.
    it('waits a minute and tries once more on a 429', async () => {
        const clock = fakeClock();
        __resetRateLimit(clock.now());
        let calls = 0;
        clock.fetch = async () => (++calls === 1)
            ? new Response('slow down', { status: 429 })
            : new Response('4242', { status: 200, headers: { 'content-type': 'application/json' } });
        expect(await getFromNearBlocks('/v1/blocks/count', clock)).to.equal(4242);
        expect(calls).to.equal(2);
        expect(clock.slept).to.deep.equal([60_000]);
    });
});
