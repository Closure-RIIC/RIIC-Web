import { spawn } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import process from "node:process";
import { cachedBuild } from "./build-cache.mjs";

const [app, ...options] = process.argv.slice(2);
if (!["arknights", "endfield"].includes(app) || options.some(option => option !== "--skip-types")) {
  throw new Error("usage: build-app.mjs <arknights|endfield> [--skip-types]");
}
const root = fileURLToPath(new URL("../", import.meta.url));
const appRoot = path.join(root, "apps", app);
async function run(script, args, cwd = root) {
  const child = spawn(process.execPath, [script, ...args], { cwd, stdio: "inherit", windowsHide: true });
  const stop = signal => child.kill(signal);
  const interrupt = () => stop("SIGINT");
  const terminate = () => stop("SIGTERM");
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  try {
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", code => code === 0 ? resolve() : reject(new Error("Build subprocess failed: " + code)));
    });
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
  }
}
await cachedBuild({ root, name: app, identity: { app, typecheck: !options.includes("--skip-types") },
  outputs: ["apps/" + app + "/.output", ...(app === "arknights" ? ["apps/arknights/dist"] : [])],
  build: async () => {
    await run(path.join(root, "scripts/run-vite.mjs"), [app, "build"]);
    if (!options.includes("--skip-types")) {
      await run(fileURLToPath(new URL("./bin/tsc", import.meta.resolve("typescript/package.json"))), ["--noEmit"], appRoot);
    }
    if (app === "arknights") await run(path.join(root, "scripts/prepare-standalone.mjs"), []);
  } });
