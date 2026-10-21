import { getTokenExclusions, setTokenExclusions } from '../storage/domainobjectstore.js';
import { writeFile } from '../storage/gitstorage.js';
import { isExcluded, excludeToken, includeToken, excludeNoPriceTokens } from './token-exclusions.js';

describe('the tokens the year report leaves out', () => {
    beforeEach(async () => {
        await setTokenExclusions({ excluded: [], kept: [] });
    });

    // The file was a bare array, read only by the all-tokens print. A store
    // that still has one keeps excluding what it excluded.
    it('reads the list as it used to be stored', async () => {
        await writeFile('ignorefungibletokens.json', JSON.stringify([{ symbol: 'MOON', contractId: 'moon.near' }]));
        expect(await getTokenExclusions()).to.deep.equal({
            excluded: [{ symbol: 'MOON', contractId: 'moon.near' }], kept: [],
        });
    });

    // NPRO and wNEAR each exist natively and inside intents under one symbol.
    it('matches by contract, and by symbol only for an entry without one', () => {
        const exclusions = { excluded: [{ contractId: 'npro.nearmobile.near', symbol: 'NPRO' }, { symbol: 'OLD' }], kept: [] };
        expect(isExcluded(exclusions, 'npro.nearmobile.near', 'NPRO')).to.equal(true);
        expect(isExcluded(exclusions, 'nep141:npro.nearmobile.near', 'NPRO')).to.equal(false);
        expect(isExcluded(exclusions, 'old.near', 'OLD')).to.equal(true);
    });

    it('adds the tokens the price service knows have no price, once', async () => {
        const added = await excludeNoPriceTokens([{ contractId: 'scam.near', symbol: 'SCAM' }]);
        expect(added.map(t => t.contractId)).to.deep.equal(['scam.near']);
        expect(await excludeNoPriceTokens([{ contractId: 'scam.near', symbol: 'SCAM' }])).to.deep.equal([]);
        expect((await getTokenExclusions()).excluded).to.deep.equal([
            { contractId: 'scam.near', symbol: 'SCAM', reason: 'no-price' },
        ]);
    });

    // Otherwise the next report would put it straight back.
    it('does not exclude again a token the user included', async () => {
        await excludeNoPriceTokens([{ contractId: 'scam.near', symbol: 'SCAM' }]);
        await includeToken('scam.near');
        expect(await excludeNoPriceTokens([{ contractId: 'scam.near', symbol: 'SCAM' }])).to.deep.equal([]);
        expect(await getTokenExclusions()).to.deep.equal({ excluded: [], kept: ['scam.near'] });
    });

    it('excludes by hand, even a token included before', async () => {
        await includeToken('moon.near');
        await excludeToken({ contractId: 'moon.near', symbol: 'MOON' });
        expect(await getTokenExclusions()).to.deep.equal({
            excluded: [{ contractId: 'moon.near', symbol: 'MOON' }], kept: [],
        });
    });
});
