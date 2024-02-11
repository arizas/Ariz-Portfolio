import { readTextFile, writeFile } from './gitstorage.js';

describe('gitstorage', () => {
    it('should write file', async function() {
        await writeFile('peter.txt', 'johan');
        expect(await readTextFile('peter.txt')).to.equal('johan');
    });
});
