import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";

const root = fileURLToPath(new URL("../", import.meta.url));
const ports = [5174, 5176, 5177];
for (const port of ports) await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", () => reject(new Error(`Port ${port} is in use; stop this launch and keep the existing service running.`)));
  probe.listen(port, "127.0.0.1", () => probe.close(resolve));
});
const environment = {
  ...process.env,
  NODE_ENV: "development",
  APP_DEPLOYMENT_ENV: "development",
  AUTH_COOKIE_DOMAIN: "",
  BETTER_AUTH_URL: "http://127.0.0.1:5174",
  PLATFORM_API_ORIGIN: "http://127.0.0.1:5177",
  PLATFORM_PUBLIC_ORIGINS: "http://127.0.0.1:5174,http://127.0.0.1:5176",
  VITE_ARKNIGHTS_ORIGIN: "http://127.0.0.1:5174",
  VITE_ENDFIELD_ORIGIN: "http://127.0.0.1:5176",
  BETA_TRUST_PROXY_HEADERS: "1",
};
const children = [
  ["scripts/build-platform.mjs", "--serve"],
  ["scripts/run-vite.mjs", "arknights", "dev", "--host", "127.0.0.1", "--port", "5174", "--strictPort"],
  ["scripts/run-vite.mjs", "endfield", "dev", "--host", "127.0.0.1", "--port", "5176", "--strictPort"],
].map(args => spawn(process.execPath, args, { cwd: root, env: environment, stdio: ["inherit", "inherit", "inherit", "ipc"], windowsHide: true }));
let closing = false;
let exited = 0;
// IPC lets launchers stop their owned child on Windows before they exit.
const stop = () => { if (!closing) { closing = true; for (const child of children) {
  if (child.connected) child.send("riic:stop");
  else if (child.exitCode === null) child.kill("SIGTERM");
} } };
for (const child of children) {
  child.on("error", error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; stop(); });
  child.on("exit", code => {
    if (!closing) { process.exitCode = code ?? 1; stop(); }
    if (++exited === children.length && process.connected) process.disconnect();
  });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
process.on("message", message => { if (message === "riic:stop") stop(); });
