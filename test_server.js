import { exec } from 'child_process';
import { startServer as startGitServer } from './bos_test_gateway/server/githttpserver.js';

// Start git server on port 15000 (hardcoded in githttpserver.js)
startGitServer();
console.log('Git server listening on port 15000');

// Start HTTP server for dist folder on port 8081 using http-server CLI
// Change to dist directory and serve from there
// Use --proxy to serve index.html for all routes (SPA support)
const httpServerProcess = exec('cd dist && npx http-server -p 8081 --cors --proxy http://localhost:8081? .', (error) => {
    if (error) {
        console.error('HTTP server error:', error);
    }
});

httpServerProcess.stdout.on('data', (data) => {
    console.log('HTTP server:', data);
});

httpServerProcess.stderr.on('data', (data) => {
    console.error('HTTP server error:', data);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down servers...');
    httpServerProcess.kill();
    process.exit(0);
});