import { playwrightLauncher } from '@web/test-runner-playwright';
import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import { importMapsPlugin } from '@web/dev-server-import-maps';
import { mockWalletRequests } from './testdata/rpcmock.js';
import { rpcs } from './public_html/near/rpc.js';

const nearBlocksCacheURL = new URL('testdata/nearblockscache.json', import.meta.url);
const archiveRpcCacheURL = new URL('testdata/archiverpccache.json', import.meta.url);
const arizGatewayCacheURL = new URL('testdata/arizgatewaycache.json', import.meta.url);
const blockdatadir = new URL('testdata/blockdata/', import.meta.url);

const nearblockscache = JSON.parse((await readFile(nearBlocksCacheURL)).toString());

const archiveRpcCache = JSON.parse((await readFile(archiveRpcCacheURL)).toString());
const arizGatewayCache = JSON.parse((await readFile(arizGatewayCacheURL)).toString());

const indexHtml = (await readFile(new URL('public_html/index.html', import.meta.url))).toString();
const importMapStart = indexHtml.indexOf('<script type="importmap">') + '<script type="importmap">'.length;
const importMapEnd = indexHtml.indexOf('</script>', importMapStart);
const importMap = JSON.parse(indexHtml.substring(importMapStart, importMapEnd));

const storeInArchiveRpcCache = true;

export default {
  files: [
    '**/*.spec.js', // include `.spec.ts` files
    '!./node_modules/**/*', // exclude any node modules
    '!./playwright_tests/**/*' // exclude playwright tests
  ],
  watch: false,
  testFramework: {
    config: {
      ui: 'bdd',
      timeout: '180000',
    },
  },
  plugins: [importMapsPlugin({
    inject: {
      importMap
    },
  })],
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
      product: 'chromium', launchOptions: {
        headless: true
      }, createBrowserContext: async ({ browser }) => {
        const ctx = await browser.newContext({});

        const archivalRpcCache = async (route) => {
          try {
            const request = route.request();

            const postdata = request.postData();

            if (archiveRpcCache[postdata]) {
              const cachedBody = archiveRpcCache[postdata];
              return await route.fulfill({ json: JSON.parse(cachedBody) });
            } else {
              console.log("not in cache", request.url(), postdata);
              const response = await route.fetch();
              if (response.ok()) {
                const body = await response.text();
                try {
                  const resultObj = JSON.parse(body);
                  if (!resultObj.error && storeInArchiveRpcCache) {
                    archiveRpcCache[postdata] = JSON.stringify(resultObj);
                    await writeFile(archiveRpcCacheURL, JSON.stringify(archiveRpcCache, null, 1));
                  }
                  return await route.fulfill({ body });                  
                } catch (e) {
                  console.log('failed parsing result', e);
                }
                return await route.fulfill({ response, body });
              }
              console.log('failed request', response.status());
              return await route.fulfill({ response });
            }
          } catch (e) {
            console.error('failed to handle route', e);
            return await route.abort("connectionfailed");
          }
        };

        for (let rpc of rpcs) {
          console.log('setting up archival rpc route for', rpc);
          await ctx.route(rpc, archivalRpcCache);
        }
        await ctx.route('https://api.nearblocks.io/**/*', async (route) => {
          const url = route.request().url();
          let headers = {};
          let body = nearblockscache[url];
          let status = 200;

          if (body === undefined) {
            try {
              const response = await route.fetch();
              status = response.status();
              body = await response.text();
              if (response.ok() && !url.endsWith('/v1/blocks/count')) {
                nearblockscache[url] = body;
                await writeFile(nearBlocksCacheURL, JSON.stringify(nearblockscache, null, 1));
              }
            } catch (e) {
              await writeFile('routeerror.txt', `${url} ${status} ${JSON.stringify(headers)}: ${body}, ${e}`);
            }
          } else {
            headers = {
              'Access-Control-Expose-Headers': 'X-Cache-Hit',
              'X-Cache-Hit': 'true'
            };
          }

          await route.fulfill({
            body, headers, status
          });
        });
        await ctx.route('https://arizgateway.azurewebsites.net/**/*', async (route) => {
          let url = route.request().url();
          url = url.substring(0, url.indexOf("&todate="));

          if (!arizGatewayCache[url]) {
            const response = await route.fetch();

            const body = await response.text();
            arizGatewayCache[url] = body;
            await writeFile(arizGatewayCacheURL, JSON.stringify(arizGatewayCache, null, 1));
          }
          const body = arizGatewayCache[url];
          await route.fulfill({ body });
        });

        await ctx.route('https://mainnet.neardata.xyz/v0/block/*', async (route) => {
          const url = route.request().url();
          const pathParts = url.split('/');
          const block = pathParts[pathParts.length - 1];
          try {
            await stat(blockdatadir);
          } catch {
            await mkdir(blockdatadir);
          }
          const blockFile = new URL(`${block}.json`, blockdatadir);
          try {
            const body = await readFile(blockFile);
            await route.fulfill({ body });
          } catch {
            const response = await route.fetch();
            const body = await response.text();
            await writeFile(blockFile, body);
            await route.fulfill({ body });
          }
        });
        await mockWalletRequests(ctx);
        await ctx.route('https://dumptoconsole', async (route) => {
          console.log(route.request().postData());
          await route.fulfill({ json: 'thanks' });
        });
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
