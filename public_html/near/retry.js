import { setProgressbarValue } from "../ui/progress-bar.js";

export async function retry(func, max_retries = 10, pause_millis = 30000) {
    let err;
    for (let n = 0; n < max_retries; n++) {
        try {
            return await func();
        } catch (e) {
            err = e;
            console.error('error', e, 'retrying in ', pause_millis, 'milliseconds');
            setProgressbarValue('indeterminate', `error ${e} retrying in ${(pause_millis / 1000).toFixed(0)} seconds`);
            await new Promise(r => setTimeout(r, pause_millis));
        }
    }
    setProgressbarValue(null);
    console.error('max retries reached');
    throw (err);
}