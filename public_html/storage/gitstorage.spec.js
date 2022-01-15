import { readTextFile, writeFile } from './gitstorage.js';

describe('gitstorage', () => {
    it('should write file', async () => {
        await writeFile('peter.txt', 'johan');
        expect(await readTextFile('peter.txt')).toEqual('johan');
    });
});
