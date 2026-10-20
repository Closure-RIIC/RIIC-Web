import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";

/* global fetch, AbortSignal */

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), "riic-workspace-release-"));
const release = path.join(temporary, "release");
let child;
try {
  // Synthetic provenance is used only in this disposable local artifact.
  const stage = spawnSync(process.execPath, ["scripts/stage-standalone-release.mjs", "--output", release], {
    cwd: root, encoding: "utf8", windowsHide: true,
    env: { ...process.env, RELEASE_SHA: "a".repeat(40), RELEASE_TREE_SHA: "b".repeat(40) },
  });
  assert.equal(stage.status, 0, stage.stderr);
  const manifest = JSON.parse(await readFile(path.join(release, "package.json"), "utf8"));
  assert.equal(manifest.scripts.start, "node scripts/start-standalone.mjs");
  assert.equal(manifest.workspaces, undefined);
  assert.deepEqual(
    await readFile(path.join(release, ".output/BUILD_ID")),
    await readFile(path.join(root, "apps/arknights/.output/BUILD_ID")),
  );
  for (const worker of ["plan", "quality", "agent"]) {
    assert.deepEqual(await readFile(path.join(release, `worker/${worker}-worker.cjs`)), await readFile(path.join(root, `dist/${worker}-worker.cjs`)));
  }
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  child = spawn(process.execPath, [path.join(release, "scripts/start-standalone.mjs"), "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: temporary, windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, NODE_ENV: "production", DATABASE_URL: "", DATABASE_MIGRATION_URL: "", AUTH_INTEGRATION_DATABASE_URL: "" },
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
  child.on("error", error => { stderr = error.message; });
  let document;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Staged server exited: ${stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(5000) });
      if (response.status === 200) { document = await response.text(); break; }
    } catch { /* Wait for the isolated server to start. */ }
    await setTimeout(250);
  }
  assert.ok(document, "staged release serves the application from an unrelated cwd");
  const asset = document.match(/(?:src|href)="(\/assets\/[^"?]+\.js)/)?.[1];
  assert.ok(asset, "document contains built client assets");
  assert.equal((await fetch(`http://127.0.0.1:${port}${asset}`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/icon.png`)).status, 200);
  process.stdout.write("Staged release passed: app output, workers, startup from unrelated cwd, HTML and static assets. No database operations.\n");
} finally {
  if (child && child.exitCode === null) {
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill();
    await exited;
  }
  assert.equal(path.dirname(temporary), path.resolve(tmpdir()));
  assert.ok(path.basename(temporary).startsWith("riic-workspace-release-"));
  await rm(temporary, { recursive: true, force: true });
}
