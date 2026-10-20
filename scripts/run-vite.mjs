import { spawn } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { loadEnvConfig } from "./load-env.mjs";

const [app, command, ...args] = process.argv.slice(2);
if (!["arknights", "endfield"].includes(app) || !["dev", "build"].includes(command)) {
  throw new Error("usage: run-vite.mjs <arknights|endfield> <dev|build> [vite arguments]");
}
// Keep runtime storage, solver paths and local env files at the repository root.
// Vite's explicit app root owns routes, public assets, caches and build output.
const root = fileURLToPath(new URL("../", import.meta.url));
if (command === "dev") {
  loadEnvConfig(app === "arknights" ? root : fileURLToPath(new URL(`../apps/${app}/`, import.meta.url)), true);
}
const child = spawn(process.execPath, [
  fileURLToPath(new URL("./bin/vite.js", import.meta.resolve("vite/package.json"))),
  ...(command === "build" ? ["build"] : []),
  `apps/${app}`, "--config", `apps/${app}/vite.config.ts`, ...args,
], { cwd: root, stdio: "inherit", windowsHide: true });
child.on("error", error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
