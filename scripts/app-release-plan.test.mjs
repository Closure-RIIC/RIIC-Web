import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { APPLICATIONS, ENDFIELD_SHARED_LEAVES, classifyAppChanges, createReleasePlan, gitRepository, workspaceConsumers } from "./app-release-plan.mjs";

const a = "a".repeat(40), b = "b".repeat(40), c = "c".repeat(40);
const manifests = {
  "apps/arknights": { name: "@riic/arknights", dependencies: { "@riic/shell": "*", "@riic/platform-server": "*", "@riic/endfield-skland": "*" } },
  "apps/endfield": { name: "@riic/endfield", dependencies: { "@riic/shell": "*", "@riic/endfield-data": "*", "@riic/platform-server": "*" } },
  "packages/shell": { name: "@riic/shell", dependencies: { "@riic/ui-primitives": "*", "@riic/arknights-domain": "*" } },
  "packages/ui-primitives": { name: "@riic/ui-primitives" },
  "packages/arknights-domain": { name: "@riic/arknights-domain", dependencies: { "@riic/contracts": "*" } },
  "packages/contracts": { name: "@riic/contracts" },
  "packages/platform-server": { name: "@riic/platform-server" },
  "packages/endfield-data": { name: "@riic/endfield-data" },
  "packages/endfield-skland": { name: "@riic/endfield-skland" },
};
const context = { beforeManifests: manifests, afterManifests: manifests };
const classify = (paths, overrides = {}) => classifyAppChanges(paths, { ...context, ...overrides });

test("application ownership, shared inputs and backend hosting select the right deployments", () => {
  for (const [file, expected] of [
    ["apps/arknights/src/App.tsx", ["arknights"]],
    ["apps/endfield/src/App.tsx", ["endfield"]],
    ["packages/endfield-data/operators.json", ["endfield"]],
    ["packages/arknights-domain/src/generated/gacha-up.json", ["arknights"]],
    ["packages/arknights-domain/src/rotation-result.ts", ["arknights"]],
    ["packages/arknights-domain/src/password-strength.ts", APPLICATIONS],
    ["packages/arknights-domain/src/i18n/config.ts", APPLICATIONS],
    ["packages/arknights-domain/src/i18n/localize.ts", APPLICATIONS],
    ["packages/contracts/locale.ts", APPLICATIONS],
    ["packages/platform-server/src/proxy.ts", APPLICATIONS],
    ["packages/platform-server/src/html-compression.ts", APPLICATIONS],
    ["packages/platform-server/src/auth/endfield-access.ts", ["arknights"]],
    ["packages/platform-server/src/skland/endfield-api.ts", ["arknights"]],
    ["apps/arknights/src/routes/api.endfield.skland.$action.ts", ["arknights"]],
    ["packages/ui-primitives/sidebar.tsx", APPLICATIONS],
    ["packages/shell/GameSwitcher.tsx", APPLICATIONS],
    ["package.json", APPLICATIONS],
    ["unclassified-runtime.mjs", APPLICATIONS],
    ["scripts/deploy-endfield.sh", ["endfield"]],
    ["scripts/pack-endfield-release.sh", ["endfield"]],
    ["deploy/endfield-deploy.py", ["endfield"]],
    ["deploy/endfield-transfer.test.py", []],
    ["docs/guide.md", []],
    ["apps/endfield/src/solver.test.ts", []],
  ]) assert.deepEqual(classify([file]).deployApps, expected, file);
  assert.deepEqual(classify(["apps/arknights/src/routes/api.endfield.skland.$action.ts"]).checkApps, APPLICATIONS);
  assert.deepEqual(classify(["packages/platform-server/src/auth/endfield-access.ts"]).checkApps, APPLICATIONS);
  assert.deepEqual(classify(["apps\\endfield\\src\\App.tsx"]).deployApps, ["endfield"]);
});

test("removed dependencies retain their former application consumers", () => {
  const after = globalThis.structuredClone(manifests);
  delete after["apps/endfield"].dependencies["@riic/endfield-data"];
  assert.deepEqual(classify(["packages/endfield-data/data.json"], { afterManifests: after }).deployApps, ["endfield"]);
  assert.deepEqual(classify(["packages/new-package/runtime.ts"]).deployApps, APPLICATIONS);
});

test("lockfile updates follow external dependency closure and fail closed when incomplete", () => {
  const simple = {
    "apps/arknights": { name: "@riic/arknights" }, "apps/endfield": { name: "@riic/endfield" },
  };
  const beforeLock = { lockfileVersion: 3, packages: {
    "": { devDependencies: { vite: "1" } },
    "apps/arknights": { dependencies: { a: "1" } }, "apps/endfield": { dependencies: { b: "1" } },
    "node_modules/a": { version: "1", dependencies: { nested: "1" } },
    "node_modules/a/node_modules/nested": { version: "1" },
    "node_modules/b": { version: "1" }, "node_modules/vite": { version: "1" },
  } };
  const afterLock = globalThis.structuredClone(beforeLock);
  afterLock.packages["node_modules/a/node_modules/nested"].version = "2";
  const options = { beforeManifests: simple, afterManifests: simple, beforeLock, afterLock };
  assert.deepEqual(classify(["package-lock.json"], options).deployApps, ["arknights"]);
  afterLock.packages["node_modules/vite"].version = "2";
  assert.deepEqual(classify(["package-lock.json"], options).deployApps, APPLICATIONS);
  assert.deepEqual(classify(["package-lock.json"], { ...options, afterLock: beforeLock }).deployApps, []);
  assert.deepEqual(classify(["package-lock.json"], { ...options, afterLock: {} }).deployApps, APPLICATIONS);
});

function planOptions(overrides = {}) {
  return { head: c, before: b, baselines: { arknights: b, endfield: b }, snapshot: () => ({ manifests }),
    diff: (base, head) => base === head ? [] : ["apps/arknights/src/App.tsx"], ...overrides };
}

test("Arknights-only pushes never redeploy unchanged Endfield even with an older Endfield baseline", async () => {
  const result = await createReleasePlan(planOptions({ baselines: { arknights: b, endfield: a } }));
  assert.deepEqual(result.deployApps, ["arknights"]);
  assert.deepEqual(result.buildApps, ["arknights"]);
  assert.deepEqual(result.checkApps, APPLICATIONS); // Required checks are intentionally retained.
});

test("a failed Endfield release remains pending after Arknights succeeds and a docs push arrives", async () => {
  const result = await createReleasePlan(planOptions({
    baselines: { arknights: b, endfield: a },
    diff: (base) => base === a ? ["apps/endfield/src/App.tsx", "docs/guide.md"] : ["docs/guide.md"],
  }));
  assert.deepEqual(result.deployApps, ["endfield"]);
  assert.equal(result.runCore, true);
  assert.equal(result.applications.endfield.baseSha, a);
});

test("empty, missing, non-ancestor, same-commit and docs-only cases are distinct", async () => {
  const same = await createReleasePlan(planOptions({ before: c, baselines: { arknights: c, endfield: c } }));
  assert.deepEqual(same.deployApps, []);
  assert.deepEqual(same.buildApps, []);
  assert.equal(same.runCore, false);
  const missing = await createReleasePlan(planOptions({ baselines: { arknights: c } }));
  assert.deepEqual(missing.deployApps, ["endfield"]);
  assert.equal(missing.runCore, true);
  const unrelated = await createReleasePlan(planOptions({ diff: () => { throw new Error("not ancestor"); } }));
  assert.deepEqual(unrelated.deployApps, APPLICATIONS);
  const docs = await createReleasePlan(planOptions({ diff: () => ["docs/new.md"] }));
  assert.deepEqual(docs.deployApps, []);
  assert.equal(docs.runCore, false);
  const manual = await createReleasePlan(planOptions({ forceFull: true, baselines: { arknights: c, endfield: c } }));
  assert.deepEqual(manual.deployApps, []);
  assert.equal(manual.runCore, true);
});

test("operator data hints cannot hide an unshipped runtime change", async () => {
  const data = await createReleasePlan(planOptions({ operatorDataBase: b,
    diff: () => ["packages/arknights-domain/src/generated/gacha-up.json"],
  }));
  assert.deepEqual(data.deployApps, ["arknights"]);
  assert.equal(data.runBrowser, false);
  const result = await createReleasePlan(planOptions({ operatorDataBase: b, baselines: { arknights: a, endfield: b },
    diff: (base) => base === a ? ["packages/arknights-domain/src/generated/gacha-up.json", "apps/arknights/src/App.tsx"] : ["packages/arknights-domain/src/generated/gacha-up.json"],
  }));
  assert.equal(result.runBrowser, true);
  await assert.rejects(createReleasePlan(planOptions({ operatorDataBase: b })), /non-data/);
});

test("narrow shared leaves cover every Endfield consumer and all their relative imports", async () => {
  // This is a dependency contract, not a UI test. New imports must expand the
  // deployment inputs before CI permits any release with a narrower scope.
  const cwd = path.resolve(import.meta.dirname, "..");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  const snapshot = gitRepository(cwd).snapshot(head);
  const consumers = workspaceConsumers(snapshot.manifests);
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(path.join(cwd, directory), { withFileTypes: true })) {
      if (["node_modules", ".output", "dist", ".tanstack"].includes(entry.name)) continue;
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(file);
      else if (/\.(?:tsx?|m?js)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) files.push(file);
    }
  }
  for (const [directory, apps] of consumers) {
    if (apps.has("endfield") && !ENDFIELD_SHARED_LEAVES[directory]) await walk(directory);
  }
  for (const [directory, leaves] of Object.entries(ENDFIELD_SHARED_LEAVES)) {
    const manifest = JSON.parse(await readFile(path.join(cwd, directory, "package.json"), "utf8"));
    const allowed = new Set(leaves.map((leaf) => `${directory}/${leaf}`));
    for (const file of files) {
      const source = await readFile(path.join(cwd, file), "utf8");
      for (const match of source.matchAll(/["'](@riic\/[a-z-]+(?:\/[^"']*)?)["']/g)) {
        if (!match[1].startsWith(manifest.name + "/") && match[1] !== manifest.name) continue;
        const subpath = match[1].slice(manifest.name.length);
        const exported = manifest.exports?.[subpath ? `.${subpath}` : "."];
        assert.equal(typeof exported, "string", `Cannot safely resolve ${match[1]} in ${file}`);
        assert.ok(allowed.has(path.posix.normalize(`${directory}/${exported}`)), `Expand ENDFIELD_SHARED_LEAVES for ${match[1]} imported by ${file}`);
      }
    }
    for (const file of allowed) {
      const source = await readFile(path.join(cwd, file), "utf8");
      for (const match of source.matchAll(/(?:from\s*|import\s*\(|require\s*\()["']([^"']+)["']/g)) {
        const specifier = match[1];
        if (specifier.startsWith(".")) {
          const resolved = path.posix.normalize(`${path.posix.dirname(file)}/${specifier}`);
          assert.ok([resolved, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}/index.ts`].some((candidate) => allowed.has(candidate)), `Expand shared leaves for ${specifier} imported by ${file}`);
        } else if (specifier.startsWith("@riic/")) {
          const packageName = specifier.split("/").slice(0, 2).join("/");
          const target = Object.entries(snapshot.manifests).find(([, entry]) => entry.name === packageName);
          assert.ok(target, `Cannot resolve transitive workspace import ${specifier} in ${file}`);
          const [targetDirectory, targetManifest] = target;
          const subpath = specifier.slice(packageName.length);
          const exported = targetManifest.exports?.[subpath ? `.${subpath}` : "."];
          assert.equal(typeof exported, "string", `Cannot safely resolve ${specifier} in ${file}`);
          const targetFile = path.posix.normalize(`${targetDirectory}/${exported}`);
          const impact = classifyAppChanges([targetFile], { beforeManifests: snapshot.manifests, afterManifests: snapshot.manifests });
          assert.ok(impact.deployApps.includes("endfield"), `Account for transitive workspace import ${specifier} in ${file}`);
        }
      }
    }
  }
});
