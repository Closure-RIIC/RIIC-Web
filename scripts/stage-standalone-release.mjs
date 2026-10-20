import assert from "node:assert/strict";
import { cp, copyFile, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const args = process.argv.slice(2);
assert.equal(args.length, 2, "usage: stage-standalone-release.mjs --output <empty-path>");
assert.equal(args[0], "--output", "usage: stage-standalone-release.mjs --output <empty-path>");

const outputRoot = path.resolve(args[1]);
const releaseSha = process.env.RELEASE_SHA ?? "";
const releaseTreeSha = process.env.RELEASE_TREE_SHA ?? "";
const relativeToRepository = path.relative(repoRoot, outputRoot);

assert.match(releaseSha, /^[0-9a-f]{40}$/, "RELEASE_SHA must be a full lowercase Git commit SHA");
assert.match(releaseTreeSha, /^[0-9a-f]{40}$/, "RELEASE_TREE_SHA must be a full lowercase Git tree SHA");
assert.ok(
  path.isAbsolute(relativeToRepository)
    || relativeToRepository === ".."
    || relativeToRepository.startsWith(`..${path.sep}`),
  "release staging output must stay outside the repository",
);

try {
  await lstat(outputRoot);
  assert.fail("release staging output must not already exist");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const requiredBuildFiles = [
  "apps/arknights/.output/BUILD_ID",
  "apps/arknights/.output/server/index.mjs",
  "apps/arknights/.output/public",
  "apps/arknights/.output/public/assets",
  "apps/arknights/.output/scripts/backfill-business-data.mjs",
  "apps/arknights/.output/scripts/migrate-db.mjs",
  "apps/arknights/.output/scripts/check-auth-readiness.mjs",
  "apps/arknights/.output/drizzle",
  "apps/arknights/.output/fixtures/operbox_full_e2.json",
  "apps/arknights/.output/scripts/load-env.mjs",
  "dist/plan-worker.cjs",
  "dist/quality-worker.cjs",
  "dist/agent-worker.cjs",
];
for (const relativePath of requiredBuildFiles) {
  await lstat(path.join(repoRoot, relativePath));
}

const forbiddenBuildEntries = [
  ["bin/infra-cli", "infra-cli"],
  ["bin/infra-cli.exe", "infra-cli.exe"],
  [".env", ".env"],
  [".env.production", ".env.production"],
  [".env.local", ".env.local"],
  [".env.production.local", ".env.production.local"],
];
for (const [relativePath, displayName] of forbiddenBuildEntries) {
  try {
    await lstat(path.join(repoRoot, "apps/arknights/.output", relativePath));
    assert.fail(`standalone website output must not contain ${displayName}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

await mkdir(path.join(outputRoot, "scripts"), { recursive: true });
await mkdir(path.join(outputRoot, ".output"), { recursive: true });
const appManifest = JSON.parse(await readFile(path.join(repoRoot, "apps/arknights/package.json"), "utf8"));
await writeFile(path.join(outputRoot, "package.json"), `${JSON.stringify({
  name: "@riic/arknights-release", version: appManifest.version, private: true, type: "module",
  scripts: { start: "node scripts/start-standalone.mjs" }, engines: { node: ">=22.12.0" },
}, null, 2)}\n`);
await copyFile(
  path.join(repoRoot, "scripts", "start-standalone.mjs"),
  path.join(outputRoot, "scripts", "start-standalone.mjs"),
);

await cp(path.join(repoRoot, "apps/arknights/.output"), path.join(outputRoot, ".output"), {
  dereference: true,
  recursive: true,
  force: true,
});
await copyFile(path.join(repoRoot, "apps/arknights/.output/scripts/load-env.mjs"), path.join(outputRoot, "scripts/load-env.mjs"));
await cp(path.join(repoRoot, "apps/arknights/.output/fixtures"), path.join(outputRoot, "fixtures"), { recursive: true });
await mkdir(path.join(outputRoot, "worker"), { recursive: true });
await copyFile(
  path.join(repoRoot, "dist", "plan-worker.cjs"),
  path.join(outputRoot, "worker", "plan-worker.cjs"),
);

await copyFile(path.join(repoRoot, "dist", "quality-worker.cjs"), path.join(outputRoot, "worker", "quality-worker.cjs"));
await copyFile(path.join(repoRoot, "dist", "agent-worker.cjs"), path.join(outputRoot, "worker", "agent-worker.cjs"));
await writeFile(path.join(outputRoot, ".release-artifact.json"), `${JSON.stringify({
  formatVersion: 1,
  kind: "riic-web-tanstack-start",
  releaseSha,
  releaseTreeSha,
}, null, 2)}\n`, "utf8");

assert.equal(await lstat(path.join(outputRoot, ".output", "server", "index.mjs")).then((entry) => entry.isFile()), true);
assert.equal(
  await lstat(path.join(outputRoot, "worker", "plan-worker.cjs")).then((entry) => entry.isFile()),
  true,
);
for (const forbiddenRootEntry of ["node_modules", "bin"]) {
  try {
    await lstat(path.join(outputRoot, forbiddenRootEntry));
    assert.fail(`standalone release root must not contain ${forbiddenRootEntry}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

process.stdout.write(`${outputRoot}\n`);
