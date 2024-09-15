import { getFromNearBlocks, MAX_CALLS_PER_MINUTE } from "./nearblocks.js";

describe('get data from nearblocks api', function () {
    it('should respect the rate limit', async function() {
        this.timeout(2 * 60_000);
        const startTime = new Date().getTime();
        for (let n = 0; n < MAX_CALLS_PER_MINUTE; n++) {
            await getFromNearBlocks('/v1/charts/tps');
        }
        expect(new Date().getTime()).to.be.lessThan(startTime + 60_000);
        await getFromNearBlocks('/v1/charts/tps');
        expect(new Date().getTime()).to.be.above(startTime + 60_000);
    });
});