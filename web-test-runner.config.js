import { playwrightLauncher } from '@web/test-runner-playwright';
import { readFile, writeFile } from 'fs/promises';

const nearBlocksCacheURL = new URL('testdata/nearblockscache.json', import.meta.url);
const archiveRpcCacheURL = new URL('testdata/archiverpccache.json', import.meta.url);
const coingeckoCacheURL = new URL('testdata/coingeckocache.json', import.meta.url);

const nearblockscache = JSON.parse((await readFile(nearBlocksCacheURL)).toString());

const archiveRpcCache = JSON.parse((await readFile(archiveRpcCacheURL)).toString());
const coingeckocache = JSON.parse((await readFile(coingeckoCacheURL)).toString());

export default {
  files: [
    '**/*.spec.js', // include `.spec.ts` files
    '!./node_modules/**/*', // exclude any node modules
    '!./playwright_tests/**/*' // exclude playwright tests
  ],
  concurrency: 1,
  watch: false,
  testFramework: {
    config: {
      ui: 'bdd',
      timeout: '20000',
    },
  },
  testRunnerHtml: testRunnerImport =>
    `<html>
      <body>
        <script type="module">
            import { expect, assert} from 'https://cdn.jsdelivr.net/npm/chai@5.0.0/+esm';
            globalThis.assert = assert;
            globalThis.expect = expect;
            localStorage.setItem('pikespeakai_api_key','API_KEY');
        </script>        
        <script type="module" src="${testRunnerImport}"></script>
      </body>
    </html>`,
  browsers: [
    playwrightLauncher({
      product: 'chromium', createBrowserContext: async ({ browser }) => {
        const ctx = await browser.newContext({});
        console.log('creating browser context');

        const archivalRpcCache = async (route) => {
          const postdata = route.request().postData();
          if (!archiveRpcCache[postdata]) {
            const response = await route.fetch();
            const body = await response.text();
            archiveRpcCache[postdata] = body;
            await writeFile(archiveRpcCacheURL, JSON.stringify(archiveRpcCache, null, 1));
          }
          const body = archiveRpcCache[postdata];
          await route.fulfill({ body });
        };
        await ctx.route('https://archival-rpc.mainnet.near.org', archivalRpcCache);
        await ctx.route('https://1rpc.io/near', archivalRpcCache);
        await ctx.route('https://api.nearblocks.io/**/*', async (route) => {
          const url = route.request().url();
          if (!nearblockscache[url]) {
            const response = await route.fetch();
            const body = await response.text();
            nearblockscache[url] = body;
            await writeFile(nearBlocksCacheURL, JSON.stringify(nearblockscache, null, 1));
          }
          const body = nearblockscache[url];
          await route.fulfill({ body });
        });
        await ctx.route('https://pro-api.coingecko.com/**/*', async (route) => {
          const url = route.request().url();
          if (!coingeckocache[url]) {
            const response = await route.fetch();

            const body = await response.text();
            coingeckocache[url] = body;
            await writeFile(coingeckoCacheURL, JSON.stringify(coingeckocache, null, 1));
          }
          const body = coingeckocache[url];
          await route.fulfill({ body });
        })
        return ctx;
      }
    }),
    /*playwrightLauncher({
      product: 'webkit',launchOptions: {
        headless: false
      }
    })*/
  ],
  testsFinishTimeout: 30 * 60000
};
