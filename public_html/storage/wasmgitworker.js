let stdout;
let stderr;
let captureOutput = false;
const currentRepoRootDir = 'nearearningsdata';

let accessToken = 'ANONYMOUS';
XMLHttpRequest.prototype._open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
  this._open(method, url, async, user, password);
  this.setRequestHeader('Authorization', `Bearer ${accessToken}`);
}

self.Module = {
  'locateFile': function (s) {
    return 'https://unpkg.com/wasm-git@0.0.10/' + s;
  },
  'print': function (text) {
    if (captureOutput) {
      stdout += text + '\n';
    }
    postMessage({ progress: text });
    console.log(text);
  },
  'printErr': function (text) {
    if (captureOutput) {
      stderr += text + '\n';
    }
    console.error(text);
  }
};

importScripts('https://unpkg.com/wasm-git@0.0.10/lg2.js');
importScripts('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.6.0/jszip.min.js');

const lgPromise = new Promise(resolve => {
  Module.onRuntimeInitialized = () => {
    FS.mkdir(`/${currentRepoRootDir}`);
    FS.mount(self.origin == 'null' ? MEMFS : IDBFS, {}, `/${currentRepoRootDir}`);
    FS.chdir(`/${currentRepoRootDir}`);

    FS.syncfs(true, () => {
      resolve(Module);
    });
  }
});

async function storeChanges() {
  await new Promise(resolve => FS.syncfs(false, resolve));
};

self.onmessage = async (msg) => {
  const lg2 = await lgPromise;
  try {
    let result;
    stderr = '';
    stdout = '';
    const params = msg.data;
    switch (params.command) {
      case 'configureuser':
        accessToken = params.accessToken;
        callMain(['config', 'user.name', params.username]);
        callMain(['config', 'user.email', params.useremail]);

        result = { accessTokenConfigured: true };
        break;
      case 'writeFile':
        FS.writeFile(params.filename, params.content);
        await storeChanges();
        break;
      case 'readTextFile':
        result = FS.readFile(params.filename, { encoding: 'utf8' });
        break;
      case 'exists':
        result = FS.analyzePath(params.path).exists;
        break;
      case 'mkdir':
        FS.mkdir(params.path);
        break;
      case 'readdir':
        result = FS.readdir(params.path);
        break;
      case 'git':
        captureOutput = true;
        callMain(params);
        captureOutput = false;
        if (['init', 'commit', 'add', 'revert', 'pull', 'fetch', 'merge', 'clone'].indexOf(params[0]) > -1) {
          await storeChanges();
        }
        result = { stdout, stderr };
        break;
      case 'getremote':
        captureOutput = true;
        callMain(['remote', 'show', '-v']);
        captureOutput = false;
        result = stdout;
        break;
      case 'setremote':
        callMain(['remote', 'remove', 'origin']);
        callMain(['remote', 'add', 'origin', params.remoteurl]);
        await storeChanges();
        break;
      case 'sync':
        captureOutput = true;
        callMain(['fetch', 'origin']);
        callMain(['merge', 'origin/master']);
        callMain(['push']);
        captureOutput = false;
        if (stderr) {
          throw stderr;
        }
        result = stdout;
        await storeChanges();
        break;
      case 'deletelocal':
        FS.unmount(`/${currentRepoRootDir}`);
        console.log('deleting database', currentRepoRootDir);
        self.indexedDB.deleteDatabase('/' + currentRepoRootDir);
        result = { deleted: currentRepoRootDir };
        break;
      case 'commitall':
        captureOutput = true;
        callMain(['status']);
        captureOutput = false;
        const outlines = stdout.split('\n');
        outlines.filter(l => l.indexOf('#	modified:') == 0).map(l => l.substr('#	modified:'.length).trim())
          .forEach(f => callMain(['add', f]));
        const unTrackedIndex = outlines.indexOf('# Untracked files:');

        if (unTrackedIndex > -1) {
          let filesToAdd = outlines.slice(unTrackedIndex + 3).map(ln => ln.substr('#\t'.length));
          filesToAdd = filesToAdd.slice(0, filesToAdd.length - 1);
          if (filesToAdd.length > 0) {
            filesToAdd.forEach(f => callMain(['add', f]));
          }
        }

        captureOutput = true;
        callMain(['status']);
        captureOutput = false;

        if (stdout.indexOf('Changes to be committed:') > -1) {
          callMain(['commit', '-m', 'add all untracked data files']);
          await storeChanges();
        } else {
          console.log('nothing to commit');
        }
        break;
      case 'exportzip':
        const zip = new JSZip();
        const addFilesToZip = async (dir) => {
          const entries = FS.readdir(dir);
          for (let entry of entries) {
            if (entry === '.' || entry === '..') continue;
            const path = `${dir}/${entry}`;
            const stats = FS.stat(path);
            if (FS.isDir(stats.mode)) {
              await addFilesToZip(path); // Recursive call for directories
            } else if (FS.isFile(stats.mode)) {
              const fileData = FS.readFile(path);
              zip.file(path, fileData);
            }
          }
        }
        await addFilesToZip(`/${currentRepoRootDir}`);
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        result = { zipUrl: url };
        break;
    }
    postMessage({ result });
  } catch (error) {
    postMessage({ error: error.toString() });
  }
};