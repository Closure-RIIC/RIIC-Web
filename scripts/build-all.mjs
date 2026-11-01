import { spawn } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import process from "node:process";
import { cachedBuild } from "./build-cache.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
await cachedBuild({ root, name: "all", identity: { typecheck: true },
  outputs: ["apps/arknights/.output", "apps/arknights/dist", "apps/endfield/.output", "services/platform-api/dist"],
  build: async () => {
    for (const args of [["scripts/build-app.mjs", "arknights"], ["scripts/build-app.mjs", "endfield"], ["scripts/build-platform.mjs"]]) {
      const child = spawn(process.execPath, [path.join(root, args[0]), ...args.slice(1)],
        { cwd: root, stdio: "inherit", windowsHide: true });
      const interrupt = () => child.kill("SIGINT");
      const terminate = () => child.kill("SIGTERM");
      process.once("SIGINT", interrupt);
      process.once("SIGTERM", terminate);
      try {
        await new Promise((resolve, reject) => {
          child.once("error", reject);
          child.once("exit", code => code === 0 ? resolve() : reject(new Error("Workspace build failed: " + code)));
        });
      } finally {
        process.removeListener("SIGINT", interrupt);
        process.removeListener("SIGTERM", terminate);
      }
    }
  } });
