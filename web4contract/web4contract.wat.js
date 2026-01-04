import { writeFile, readFile } from 'fs/promises';

// Read the built index.html and encode as base64
const indexHtml = await readFile(new URL('../dist/index.html', import.meta.url));
const base64Body = indexHtml.toString('base64');

const web4json = {
    contentType: "text/html; charset=UTF-8",
    body: base64Body
};

const web4jsonstring = JSON.stringify(web4json);

// Calculate number of 64KB memory pages needed (each page = 65536 bytes)
const memoryPages = Math.ceil(web4jsonstring.length / 65536);

await writeFile(new URL('web4contract.wat', import.meta.url), `
(module
    (import "env" "value_return" (func $value_return (param i64 i64)))
    (func (export "web4_get")
      i64.const ${web4jsonstring.length}
      i64.const 0
      call $value_return
    )
    (memory ${memoryPages})
    (data (i32.const 0) "${web4jsonstring.replace(/\\/g, "\\\\").replace(/\"/g,"\\\"")}")
)`);
