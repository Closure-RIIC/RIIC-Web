import assert from "node:assert/strict";
import { cp, lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { build } from "esbuild";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const standaloneRoot = path.join(repoRoot, "apps/arknights/.output");
assert.ok((await lstat(path.join(standaloneRoot, "server/index.mjs"))).isFile(), "TanStack Start Node server is missing");
for (const relative of ["bin/infra-cli", "bin/infra-cli.exe", ".env", ".env.production", ".env.local", ".env.production.local"]) {
  await lstat(path.join(standaloneRoot, relative)).then(() => { throw new Error("standalone website output must not contain " + relative); }, (error) => { if (error.code !== "ENOENT") throw error; });
}
await cp(path.join(repoRoot, "drizzle"), path.join(standaloneRoot, "drizzle"), { recursive: true });
await cp(path.join(repoRoot, "fixtures"), path.join(standaloneRoot, "fixtures"), { recursive: true });
await mkdir(path.join(standaloneRoot, "scripts"), { recursive: true });
await build({
  absWorkingDir: repoRoot,
  entryPoints: ["scripts/migrate-db.mts", "scripts/backfill-business-data.mts", "scripts/check-auth-readiness.mts"],
  bundle: true, platform: "node", format: "esm", outdir: path.join(standaloneRoot, "scripts"),
  outExtension: { ".js": ".mjs" },
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
await build({
  absWorkingDir: repoRoot, entryPoints: ["scripts/load-env.mjs"],
  bundle: true, platform: "node", format: "esm", outfile: path.join(standaloneRoot, "scripts/load-env.mjs"),
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
await cp(path.join(repoRoot, "apps/arknights/dist/riic-build.json"), path.join(standaloneRoot, "riic-build.json"));
await writeFile(path.join(standaloneRoot, "BUILD_ID"), process.env.APP_BUILD_ID ?? "local-development");
await cp(path.join(repoRoot, "apps/arknights/src/app/icon.png"), path.join(standaloneRoot, "public/icon.png"));
await cp(path.join(repoRoot, "apps/arknights/src/app/apple-icon.png"), path.join(standaloneRoot, "public/apple-icon.png"));
process.stdout.write("Prepared TanStack Start Node runtime, operational commands and public assets.\n");
