import html from '@web/rollup-plugin-html';
import { terser } from 'rollup-plugin-terser';
import OMT from '@surma/rollup-plugin-off-main-thread';
import copy from 'rollup-plugin-copy';

export default {
    input: './public_html/index.html',
    output: { dir: 'dist', format: 'esm' },
    plugins: [
        html({ include: '**/*.html', minify: false }),
        OMT(),
        terser(),
        copy({
            targets: [
                { src: 'public_html/serviceworker.js', dest: 'dist/' },
            ]
        })
    ]
};