import assert from "node:assert/strict";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { loadEnvConfig } from "./load-env.mjs";

process.env.NODE_ENV ??= "production";
loadEnvConfig(fileURLToPath(new URL("../.output", import.meta.url)), false);

const args = process.argv.slice(2);
let hostname = process.env.ARKNIGHTS_INFRA_HOSTNAME || "0.0.0.0";
let port = process.env.PORT || "5174";

for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "-H" || argument === "--hostname") {
    hostname = args[index + 1] ?? "";
    index += 1;
  } else if (argument.startsWith("--hostname=")) {
    hostname = argument.slice("--hostname=".length);
  } else if (argument === "-p" || argument === "--port") {
    port = args[index + 1] ?? "";
    index += 1;
  } else if (argument.startsWith("--port=")) {
    port = argument.slice("--port=".length);
  } else {
    throw new Error(`Unsupported standalone server argument: ${argument}`);
  }
}

assert.match(hostname, /^[A-Za-z0-9._:-]+$/, "standalone hostname is invalid");
assert.match(port, /^\d{1,5}$/, "standalone port is invalid");
const numericPort = Number(port);
assert.ok(numericPort > 0 && numericPort <= 65_535, "standalone port is outside the TCP range");

process.env.NITRO_HOST = hostname;
process.env.HOST = hostname;
process.env.PORT = String(numericPort);
await import(new URL("../.output/server/index.mjs", import.meta.url).href);
