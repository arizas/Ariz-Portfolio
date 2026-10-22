import { startServer as startGitServer } from './githttpserver.js';
import { startDistServer } from '../dist-preview.mjs';

// Start git server on port 15000 (hardcoded in githttpserver.js)
startGitServer();
console.log('Git server listening on port 15000');

// Serve dist/ the way the gateway does: a plain static server would hand out
// the bundle's Content-Security-Policy nonce placeholder, and the page would
// run no script at all. Every path gets the page, as an SPA needs.
const appserver = await startDistServer(8081);
console.log("App HTTP server serving dist/ on port 8081");

// Verify servers are running
setTimeout(async () => {
  try {
    console.log('Git server:', await fetch('http://localhost:15000/ping').then(r => r.statusText));
    console.log('App server:', await fetch('http://localhost:8081').then(r => r.statusText));
  } catch (error) {
    console.error('Server verification failed:', error);
  }
}, 1000);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down servers...');
  appserver.close();
  process.exit(0);
});