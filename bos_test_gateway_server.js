// startServer.mjs
import httpServer from "http-server";
import path from "path";
import { spawn } from "child_process";
import { homedir } from "os";

// Start the HTTP server
const server = httpServer.createServer({
  root: path.join(process.cwd(), "bos_test_gateway"),
});

server.listen(8080, () => {
  console.log("HTTP server is listening on port 8080");
});

const bosLoader = spawn(`${homedir()}/.cargo/bin/bos-loader`, ["arizas.near", "--path", "./bos_components/account-report"], { stdio: "inherit" });

bosLoader.on("close", (code) => {
  console.log(`bosLoader process exited with code ${code}`);
});
