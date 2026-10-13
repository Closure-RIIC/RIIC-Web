import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evalRoot = resolve(webRoot, "..", "ArknightsInfraEval");
const manifest = join(evalRoot, "Cargo.toml");
const rawWasm = join(evalRoot, "target", "wasm32-unknown-unknown", "release", "infra_eval_wasm.wasm");
const generated = join(webRoot, "public", "wasm");
const temporary = join(evalRoot, "target", "web-bindgen");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: evalRoot, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(manifest)) {
  throw new Error(`ArknightsInfraEval workspace is missing: ${evalRoot}`);
}

run("cargo", ["build", "--manifest-path", manifest, "-p", "infra-eval-wasm", "--target", "wasm32-unknown-unknown", "--release"]);
rmSync(temporary, { recursive: true, force: true });
mkdirSync(temporary, { recursive: true });
run("wasm-bindgen", [rawWasm, "--target", "web", "--out-dir", temporary, "--no-typescript"]);

const wasm = readFileSync(join(temporary, "infra_eval_wasm_bg.wasm"));
const hash = createHash("sha256").update(wasm).digest("hex").slice(0, 12);
const wasmName = `infra-eval.v3-0c35f30.${hash}.wasm`;
mkdirSync(generated, { recursive: true });
for (const name of readdirSync(generated)) {
  if (name.startsWith("infra-eval.") && name.endsWith(".wasm")) rmSync(join(generated, name));
}
cpSync(join(temporary, "infra_eval_wasm.js"), join(generated, "infra_eval_wasm.js"));
writeFileSync(join(generated, wasmName), wasm);
writeFileSync(join(webRoot, "src", "lib", "infra-eval", "manifest.ts"), `export const INFRA_EVAL_MANIFEST = {\n  api: "riic-infra-eval/v1",\n  ruleset: "v3-0c35f30",\n  wasmUrl: "/wasm/${wasmName}",\n} as const;\n`);
console.log(`Installed ${wasmName}`);
