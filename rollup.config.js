import html from '@web/rollup-plugin-html';
import { terser } from 'rollup-plugin-terser';
import { readFileSync, unlinkSync, writeFileSync } from 'fs';
import copy from 'rollup-plugin-copy';

export default {
    input: './public_html/index.html',
    output: { dir: 'dist', format: 'esm' },
    plugins: [
        html({ include: '**/*.html', minify: false }),
        (() => ({
            transform(code, id) {
                const urlMatch = code.match(/(new URL\([^),]+\,\s*import.meta.url\s*\))/);
                if (urlMatch) {
                    const urlWithAbsolutePath = urlMatch[1].replace('import.meta.url', `'file://${id}'`);

                    const func = new Function('return ' + urlWithAbsolutePath);
                    const resolvedUrl = func();
                    const pathname = resolvedUrl.pathname;

                    if (pathname.endsWith('.js')) {
                        code = code.replace(urlMatch[0], `URL.createObjectURL(new Blob([
                            (() => {
                                function jsFunc() {${readFileSync(pathname).toString()}}
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
        copy({
            targets: [
                { src: 'public_html/serviceworker.js', dest: 'dist/' },
            ]
        }),
        copy({
            targets: [
                { src: 'public_html/sandboxiframe.html', dest: 'dist/' },
            ]
        })
    ]
};