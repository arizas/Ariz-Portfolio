export async function retry(func, max_retries = 5, pause_millis = 5000) {
    let err;
    for (let n = 0;n<max_retries;n++) {
        try {
            return await func();
        } catch(e) {
            err = e;
            console.error('error', e, 'retrying in ', pause_millis, 'milliseconds');
            await new Promise(r => setTimeout(r, pause_millis));
        }
    }
    console.error('max retries reached');
    throw (err);
}