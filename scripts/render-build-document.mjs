import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { setTimeout } from "node:timers/promises";

/* global fetch, AbortSignal */

/** Cookie-localized pages are dynamic, so inspect their real production HTML. */
export async function renderBuildDocument(pathname = "/", expectedStatus = 200) {
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", resolve); });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const root = fileURLToPath(new URL("../", import.meta.url));
  const child = spawn(process.execPath, [path.join(root, "scripts/start-standalone.mjs"), "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root, env: { ...process.env, NODE_ENV: "production" }, windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
  });
  let failure;
  child.on("error", (error) => { failure = error; });
  child.stderr.resume();
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      if (child.exitCode !== null) throw new Error(`Production document server exited with ${child.exitCode}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { signal: AbortSignal.timeout(10_000) });
        if (response.status === expectedStatus) return await response.text();
      } catch { /* Wait until the local server accepts requests. */ }
      await setTimeout(250);
    }
    throw new Error("Production document server did not become ready within 60 seconds");
  } finally {
    child.kill();
  }
}
