import { spawn } from "node:child_process";
import process from "node:process";
import console from "node:console";

const port = process.argv[2] ?? "5174";
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) {
  throw new Error("Choose a local port between 1024 and 65535.");
}
const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", port], {
  stdio: "inherit",
  env: {
    ...process.env,
    ADMIN_UI_PREVIEW: "1",
    APP_DEPLOYMENT_ENV: "local",
    DATABASE_URL: "",
    DATABASE_MIGRATION_URL: "",
    AUTH_INTEGRATION_DATABASE_URL: "",
    SKLAND_FEATURE_ENABLED: "1",
    BETA_DEBUG_TOOLS_ENABLED: "0",
  },
});
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
