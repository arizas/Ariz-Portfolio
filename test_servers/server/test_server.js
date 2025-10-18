import httpServer from "http-server";
import path from "path";
import { startServer as startGitServer } from './githttpserver.js';

// Start git server on port 15000 (hardcoded in githttpserver.js)
startGitServer();
console.log('Git server listening on port 15000');

// Start the HTTP server - use public_html for development, dist for CI
const serverRoot = process.env.TEST_SERVER_ROOT || "dist";
const appserver = httpServer.createServer({
  root: path.join(process.cwd(), serverRoot),
  cors: true,
  cache: -1,
  proxy: 'http://localhost:8081?'  // SPA support - serve index.html for all routes
});

appserver.listen(8081, () => {
  console.log(`App HTTP server serving ${serverRoot}/ on port 8081`);
});

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