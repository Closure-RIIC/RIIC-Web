import assert from "node:assert/strict";
import { cp, copyFile, lstat, mkdir, writeFile } from "node:fs/promises";
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
  ".next/BUILD_ID",
  ".next/standalone/server.js",
  ".next/standalone/public",
  ".next/standalone/.next/static",
  ".next/standalone/scripts/backfill-business-data.mts",
  ".next/standalone/scripts/migrate-db.mts",
  ".next/standalone/scripts/check-auth-readiness.mts",
  ".next/standalone/src/server/auth/config.ts",
  ".next/standalone/src/server/business-backfill.ts",
  ".next/standalone/drizzle",
  ".next/standalone/node_modules/drizzle-orm",
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
    await lstat(path.join(repoRoot, ".next", "standalone", relativePath));
    assert.fail(`standalone website output must not contain ${displayName}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

await mkdir(path.join(outputRoot, "scripts"), { recursive: true });
await mkdir(path.join(outputRoot, ".next"), { recursive: true });
await copyFile(path.join(repoRoot, "package.json"), path.join(outputRoot, "package.json"));
await copyFile(
  path.join(repoRoot, "scripts", "start-standalone.mjs"),
  path.join(outputRoot, "scripts", "start-standalone.mjs"),
);
await copyFile(path.join(repoRoot, ".next", "BUILD_ID"), path.join(outputRoot, ".next", "BUILD_ID"));
await cp(path.join(repoRoot, ".next", "standalone"), path.join(outputRoot, ".next", "standalone"), {
  dereference: true,
  recursive: true,
  force: true,
});
await mkdir(path.join(outputRoot, "worker"), { recursive: true });
await copyFile(
  path.join(repoRoot, "dist", "plan-worker.cjs"),
  path.join(outputRoot, "worker", "plan-worker.cjs"),
);

await copyFile(path.join(repoRoot, "dist", "quality-worker.cjs"), path.join(outputRoot, "worker", "quality-worker.cjs"));
await copyFile(path.join(repoRoot, "dist", "agent-worker.cjs"), path.join(outputRoot, "worker", "agent-worker.cjs"));
await writeFile(path.join(outputRoot, ".release-artifact.json"), `${JSON.stringify({
  formatVersion: 1,
  kind: "riic-web-standalone",
  releaseSha,
  releaseTreeSha,
}, null, 2)}\n`, "utf8");

assert.equal(await lstat(path.join(outputRoot, ".next", "standalone", "server.js")).then((entry) => entry.isFile()), true);
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
