import http from 'http';
import fs from 'fs';
import cgi from 'cgi';
import { tmpdir } from 'os';
import { execSync } from 'child_process';


/**
 * This example will create a git http server to repositories on your local disk.
 * Set the GIT_PROJECT_ROOT environment variable to point to location of your git repositories.
 */

export function startServer() {
    const testrepodir = `${tmpdir()}/testrepo.git`;
    fs.rmSync(testrepodir, { recursive: true, force: true });
    execSync(`git init --initial-branch=master --bare ${tmpdir()}/testrepo.git`);

    const script = 'git';

    const gitcgi = cgi(script, {
        args: ['http-backend'],
        stderr: process.stderr,
        env: {
            'GIT_PROJECT_ROOT': tmpdir(),
            'GIT_HTTP_EXPORT_ALL': '1',
            'REMOTE_USER': 'test@example.com' // Push requires authenticated users by default
        }
    });

    return http.createServer((request, response) => {
        console.log('git http server request', request.url, request.method);

        if (request.method === 'OPTIONS') {
            response.writeHead(200, {
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Allow-Origin': '*'
            });
            response.end();
        } else {
            let path = request.url.substring(1);

            response.setHeader('Access-Control-Allow-Headers', '*');
            response.setHeader('Access-Control-Allow-Origin', '*');

            if (path.indexOf('ping') > -1) {
                response.statusCode = 200;
                response.end('pong');
            } else if (path.indexOf('git-upload') > -1 ||
                path.indexOf('git-receive') > -1) {

                let tokenError;
                try {
                    const token = request.headers['authorization'].split(' ')[1].split('.')[0];
                    const accountIdFromToken = JSON.parse(Buffer.from(token, 'base64').toString()).accountId;
                    if (accountIdFromToken !== 'test.near') {
                        tokenError = `expected account id test.near, but was ${accountIdFromToken}`;
                    }
                } catch (e) {
                    tokenError = e.toString();
                }
                if (tokenError) {
                    console.error(tokenError);
                    response.statusCode = 401;
                    response.end(tokenError);
                } else {
                    gitcgi(request, response);
                }
            } else {
                response.statusCode = 404;
                response.end('not found');
            }
        }
    }).listen(15000);
}

export default {
    startServer: startServer
}
