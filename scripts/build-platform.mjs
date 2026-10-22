import { build } from "esbuild";
import { spawn } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import process from "node:process";
import { loadEnvConfig } from "./load-env.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
await build({
  absWorkingDir: root, entryPoints: ["services/platform-api/src/server.ts"],
  outfile: "services/platform-api/dist/server.mjs", bundle: true, platform: "node", target: "node22", format: "esm",
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
  plugins: [{ name: "platform-server-only", setup(builder) {
    builder.onResolve({ filter: /^@tanstack\/react-start\/server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
    builder.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
  } }],
});
if (process.argv.includes("--serve")) {
  loadEnvConfig(root, true);
  const child = spawn(process.execPath, [path.join(root, "services/platform-api/dist/server.mjs")], { cwd: root, stdio: "inherit", windowsHide: true });
  child.on("error", error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
  child.on("exit", code => { process.exitCode = code ?? 1; if (process.connected) process.disconnect(); });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  process.on("message", message => { if (message === "riic:stop") child.kill("SIGTERM"); });
}
