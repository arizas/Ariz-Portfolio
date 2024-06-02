// startServer.mjs
import httpServer from "http-server";
import path from "path";
import { spawn } from "child_process";
import { homedir } from "os";
import { startServer as startGitServer } from './githttpserver.js';

await startGitServer();

// Start the HTTP server
const gatewayserver = httpServer.createServer({
  root: path.join(process.cwd(), "bos_test_gateway/public_html"),
});

gatewayserver.listen(8080, () => {
  console.log("Gateway HTTP server is listening on port 8080");
});


// Start the HTTP server
const appserver = httpServer.createServer({
  root: path.join(process.cwd(), "dist"),
});

appserver.listen(8081, () => {
  console.log("App HTTP server is listening on port 8081");
});

const bosLoader = spawn(`${homedir()}/.cargo/bin/bos-loader`, ["arizas.near", "--path", "./bos_components"], { stdio: "inherit" });

bosLoader.on("close", (code) => {
  console.log(`bosLoader process exited with code ${code}`);
});

process.on('exit', () => bosLoader.kill());