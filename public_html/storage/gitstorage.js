import { isProgressBarVisible, setProgressbarValue } from "../ui/progress-bar.js";

const worker = new Worker(new URL('wasmgitworker.js', import.meta.url));

let currentCommandInProgress;
const workerCommand = async (command, params) => {
    while (currentCommandInProgress) {
        await currentCommandInProgress;
    }
    currentCommandInProgress = new Promise((resolve, reject) => {
        const progressBarWasAlreadyVisible = isProgressBarVisible();
        worker.onmessage = (msg) => {
            currentCommandInProgress = null;
            if (msg.data.error) {
                reject(msg.data.error);
            } else if(msg.data.progress) {
                setProgressbarValue('indeterminate', msg.data.progress);
            } else {
                if (!progressBarWasAlreadyVisible) {
                    setProgressbarValue(null);
                }
                resolve(msg.data);
            }
        }
        worker.postMessage(Object.assign(params, { command }));
    });
    return currentCommandInProgress;
}

export async function writeFile(filename, content) {
    return await workerCommand('writeFile', { filename, content });
}

export async function readTextFile(filename) {
    return (await workerCommand('readTextFile', { filename })).result;
}

export async function exists(path) {
    return (await workerCommand('exists', { path })).result;
}

export async function mkdir(path) {
    await workerCommand('mkdir', { path });
}

export async function readdir(path) {
    return (await workerCommand('readdir', { path })).result;
}

export async function git_init() {
    return (await workerCommand('git', ['init', '.'])).result;
}

export async function git_clone(remoteurl) {
    return (await workerCommand('git', ['clone', remoteurl, '.'])).result;
}

export async function commit_all() {
    return (await workerCommand('commitall', [])).result;
}

export async function configure_user(params) {
    return (await workerCommand('configureuser', params)).result;
}

export async function set_remote(remoteurl) {
    return (await workerCommand('setremote', {remoteurl})).result;
}

export async function get_remote() {
    const remote = (await workerCommand('getremote', [])).result;
    if (remote) {
        return remote.split('\n')[0].split(/\s+/)[1];
    } else {
        return null;
    }
}

export async function sync() {
    await workerCommand('sync', []);
}

export async function delete_local() {
    await workerCommand('deletelocal', []);
}