import { exportZip, readTextFile, writeFile } from './gitstorage.js';
import 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.6.0/jszip.min.js';

describe('gitstorage', () => {
    it('should write file', async function () {
        await writeFile('peter.txt', 'johan');
        expect(await readTextFile('peter.txt')).to.equal('johan');
    });
    it('should export git repository to a zip file', async function () {
        await writeFile('peter.txt', 'johan');
        await writeFile('johan.txt', 'salomonsen');
        const url = await exportZip();
        const blob = await fetch(url).then(r => r.blob());
        var zip = new JSZip();
        const contents = await zip.loadAsync(blob);
        expect(await contents.file("/nearearningsdata/peter.txt").async('string')).to.equal('johan');;
        expect(await contents.file("/nearearningsdata/johan.txt").async('string')).to.equal('salomonsen');;
    });
});
