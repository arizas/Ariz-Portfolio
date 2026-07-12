import html from '@web/rollup-plugin-html';
import { terser } from 'rollup-plugin-terser';
import { readFileSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import copy from 'rollup-plugin-copy';

// Read a worker's source with its static relative imports resolved inline, so it
// can be embedded as a self-contained blob (the inlining wraps the source in a
// function, where static `import`/`export` are illegal). Module workers with
// dynamic import() are fine — those stay as runtime imports. One level deep,
// which is all the workers here need.
function workerSourceWithInlinedImports(workerPath) {
    const dir = dirname(workerPath);
    return readFileSync(workerPath).toString().replace(
        /^\s*import\s+\{[^}]*\}\s+from\s+['"](\.[^'"]+)['"];?\s*$/gm,
        (_, rel) => readFileSync(resolve(dir, rel)).toString().replace(/^export\s+/gm, '')
    );
}

export default {
    input: './public_html/index.html',
    output: { dir: 'dist', format: 'esm' },
    plugins: [
        html({ include: '**/*.html', minify: false }),
        (() => ({
            transform(code, id) {
                // Rewrite EVERY worker-URL expression, not just the first — a
                // second `new Worker(new URL(...))` in a module would otherwise
                // reach the single-file bundle unresolved and fail at runtime
                // (the SPA fallback serves index.html as the worker script).
                for (const urlMatch of [...code.matchAll(/new URL\([^),]+\,\s*import.meta.url\s*\)/g)]) {
                    const urlWithAbsolutePath = urlMatch[0].replace('import.meta.url', `'file://${id}'`);

                    let pathname;
                    try {
                        pathname = new Function('return ' + urlWithAbsolutePath)().pathname;
                    } catch {
                        continue; // matched text that isn't an evaluable expression (e.g. a comment)
                    }

                    if (pathname.endsWith('.js')) {
                        code = code.replace(urlMatch[0], `URL.createObjectURL(new Blob([
                            (() => {
                                function jsFunc() {${workerSourceWithInlinedImports(pathname)}}
                                const jsFuncSource = jsFunc.toString();
                                return jsFuncSource.substring( jsFuncSource.indexOf('{') + 1,  jsFuncSource.lastIndexOf('}'));
                            })()
                        ], { type: 'text/javascript' }))`);
                    }
                }
                return {
                    code: code
                }
            }
        }))(),
        terser(),
        {
            name: 'inline-js',
            closeBundle: () => {
                const js = readFileSync('dist/app.js').toString();
                const html = readFileSync('dist/index.html').toString()
                    .replace(`<script type="module" src="./app.js"></script>`,
                        `<script type="module">${js}</script>`);
                writeFileSync('dist/index.html', html);
                unlinkSync(`dist/app.js`);
            }
        },
        /*copy({
            targets: [
                { src: 'public_html/serviceworker.js', dest: 'dist/' },
            ]
        }),
        copy({
            targets: [
                { src: 'public_html/sandboxiframe.html', dest: 'dist/' },
            ]
        })*/
    ]
};