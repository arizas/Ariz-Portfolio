import { writeFile } from 'fs/promises';

const web4json = {
    contentType: 
    "text/html; charset=UTF-8", 
    bodyUrl: "https://ipfs.web4.near.page/ipfs/bafybeiabj7zuahlnm65oayewsahpc55qfekethh5nm2kpgkwemnwhqawam/"
};

const web4jsonstring = JSON.stringify(web4json);

await writeFile(new URL('web4contract.wat', import.meta.url), `
(module
    (import "env" "value_return" (func $value_return (param i64 i64)))
    (func (export "web4_get")
      i64.const ${web4jsonstring.length}
      i64.const 0
      call $value_return
    )
    (memory 1)
    (data (i32.const 0) "${web4jsonstring.replace(/\"/g,"\\\"")}")
)`);
