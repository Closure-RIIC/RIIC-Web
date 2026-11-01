import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { cachedBuild } from "./build-cache.mjs";

async function fixture(context) {
  const root = await mkdtemp(path.join(tmpdir(), "riic-build-cache-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet", root], { windowsHide: true });
  await mkdir(path.join(root, "node_modules"));
  await writeFile(path.join(root, ".gitignore"), "node_modules/\noutput/\n.env*\n");
  await writeFile(path.join(root, "source.ts"), "first source");
  await writeFile(path.join(root, "node_modules/.package-lock.json"), "{}");
  let builds = 0;
  const run = (overrides = {}) => cachedBuild({ root, name: "fixture", outputs: ["output"],
    identity: { typecheck: true }, environment: { APP_BUILD_ID: "local" }, log: () => {},
    build: async () => {
      builds += 1;
      await mkdir(path.join(root, "output"), { recursive: true });
      await writeFile(path.join(root, "output/server.js"), await readFile(path.join(root, "source.ts")));
    }, ...overrides });
  return { root, run, builds: () => builds };
}

test("unchanged inputs and verified outputs reuse a successful build", async context => {
  const current = await fixture(context);
  assert.equal(await current.run(), false);
  assert.equal(await current.run(), true);
  assert.equal(current.builds(), 1);
});

test("source, untracked files, ignored env files and installation changes invalidate reuse", async context => {
  const current = await fixture(context);
  await current.run();
  for (const [file, content] of [["source.ts", "changed"], ["new.ts", "new source"],
    [".env.production", "VITE_FEATURE=changed"], ["node_modules/.package-lock.json", '{"changed":true}']]) {
    await writeFile(path.join(current.root, file), content);
    assert.equal(await current.run(), false, file);
    assert.equal(await current.run(), true, file);
  }
  assert.equal(current.builds(), 5);
});

test("environment changes and an unchecked build never satisfy a checked build", async context => {
  const current = await fixture(context);
  await current.run();
  assert.equal(await current.run({ environment: { APP_BUILD_ID: "changed" } }), false);
  assert.equal(await current.run({ identity: { typecheck: false } }), false);
  assert.equal(await current.run(), false);
});

test("missing, corrupted or extra output files prevent cache hits", async context => {
  const current = await fixture(context);
  await current.run();
  await writeFile(path.join(current.root, "output/server.js"), "corrupt");
  assert.equal(await current.run(), false);
  await writeFile(path.join(current.root, "output/unexpected.js"), "extra");
  assert.equal(await current.run(), false);
  await rm(path.join(current.root, "output"), { recursive: true });
  assert.equal(await current.run(), false);
});

test("CI always builds and failures cannot create reusable state", async context => {
  const current = await fixture(context);
  await current.run();
  assert.equal(await current.run({ environment: { CI: "true" } }), false);
  await writeFile(path.join(current.root, "source.ts"), "bad source");
  await assert.rejects(current.run({ build: async () => { throw new Error("typecheck failed"); } }), /typecheck failed/);
  assert.equal(await current.run(), false);
  assert.equal(await current.run(), true);
});

test("changes during a build do not produce a reusable cache", async context => {
  const current = await fixture(context);
  await current.run({ build: async () => {
    await writeFile(path.join(current.root, "source.ts"), "edited during build");
    await mkdir(path.join(current.root, "output"));
    await writeFile(path.join(current.root, "output/server.js"), "old output");
  } });
  assert.equal(await current.run(), false);
});
