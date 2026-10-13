import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";

import { classifyChanges } from "./ci-change-scope.mjs";

const execFileAsync = promisify(execFile);
const classifierPath = fileURLToPath(new URL("./ci-change-scope.mjs", import.meta.url));

function assertScope(paths, expected, options) {
  const actual = classifyChanges(paths, options);
  assert.deepEqual(
    {
      scope: actual.scope,
      reason: actual.reason,
      documentationOnly: actual.documentationOnly,
      runCore: actual.runCore,
      runBrowser: actual.runBrowser,
      deployRequired: actual.deployRequired,
    },
    expected,
  );
}

test("documentation and repository metadata use the lightweight gate", () => {
  assertScope(["docs/计算逻辑.md", ".gitignore", "README.md"], {
    scope: "documentation",
    reason: "documentation-and-repository-metadata-only",
    documentationOnly: true,
    runCore: false,
    runBrowser: false,
    deployRequired: false,
  });
});

test("unit tests and non-release CI files run core checks without browser or deploy", () => {
  assertScope(
    ["src/efficiency.test.ts", ".github/dependabot.yml", "docs/testing.md"],
    {
      scope: "tooling-or-tests",
      reason: "tooling-or-unit-test-only-change",
      documentationOnly: false,
      runCore: true,
      runBrowser: false,
      deployRequired: false,
    },
  );
});

test("browser tests run Chromium but do not create an application release", () => {
  assertScope(["e2e/production-readiness.spec.ts", "playwright.config.ts"], {
    scope: "browser-tests",
    reason: "browser-test-only-change",
    documentationOnly: false,
    runCore: true,
    runBrowser: true,
    deployRequired: false,
  });
});

test("release workflow changes skip business E2E but exercise deployment", () => {
  assertScope([".github/workflows/frontend-quality.yml"], {
    scope: "tooling-or-tests",
    reason: "release-workflow-change",
    documentationOnly: false,
    runCore: true,
    runBrowser: false,
    deployRequired: true,
  });
});

test("runtime and unclassified changes always use the full gate", () => {
  for (const path of [
    "src/App.tsx",
    ".gitattributes",
    "package.json",
    "deploy/PUBLIC_DEPLOYMENT_SOURCE",
    "unknown/config.data",
  ]) {
    assertScope([path], {
      scope: "full",
      reason: "runtime-or-unclassified-change",
      documentationOnly: false,
      runCore: true,
      runBrowser: true,
      deployRequired: true,
    });
  }
});

test("mixed documentation and runtime changes cannot use a fast path", () => {
  assertScope(["docs/guide.md", "src/server/infra.ts"], {
    scope: "full",
    reason: "runtime-or-unclassified-change",
    documentationOnly: false,
    runCore: true,
    runBrowser: true,
    deployRequired: true,
  });
});

test("managed operator updates keep core checks, build and deploy without browser E2E", () => {
  for (const paths of [
    ["src/generated/arkntools/operator-catalog.json", "public/images/operator-portraits/393_toledo.webp", "fixtures/operbox_full_e2.json"],
    ["src/generated/mastery-data.json", "public/images/building-skills/bskill_recycle_spd&cost1.png", "docs/data.md"],
    ["public/images/products/gold.webp"],
    ["src/generated/gacha-up.json"],
    ["src/generated/gacha-up.json", "src/generated/arkntools/operator-catalog.json"],
    [".\\src\\generated\\arkntools\\operator-rarities.json"],
  ]) {
    assertScope(paths, {
      scope: "operator-data", reason: "managed-operator-data-only", documentationOnly: false,
      runCore: true, runBrowser: false, deployRequired: true,
    });
  }
});

test("data mixed with UI, logic, dependencies, generator changes or unrecognized assets retains E2E", () => {
  for (const changed of ["src/App.tsx", "src/server/infra.ts", "package-lock.json", "scripts/arkntools-assets-lib.mjs",
    "public/images/operator-portraits/injected.js", "src/generated/arkntools/unknown.json", "e2e/operator-search.spec.ts"] ) {
    assert.equal(classifyChanges(["src/generated/arkntools/operator-catalog.json", changed]).runBrowser, true, changed);
  }
  assert.equal(classifyChanges(["src/generated/arkntools/operator-catalog.json"], { forceFull: true }).runBrowser, true);
  assert.equal(classifyChanges(["src/generated/gacha-up.json", "scripts/sync-gacha-up.mjs"]).runBrowser, true);
  assert.equal(classifyChanges(["src/generated/gacha-up.json", "src/gacha-history.ts"]).runBrowser, true);
});

test("manual data mode rejects non-data and empty diffs before emitting gate outputs", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "arkinfra-data-scope-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, "paths.zlist");
  for (const paths of ["", "src/App.tsx\0", "src/generated/arkntools/operator-catalog.json\0src/server/infra.ts\0"]) {
    await writeFile(input, paths);
    await assert.rejects(execFileAsync(process.execPath, [classifierPath, "--input", input, "--require-operator-data"]), /non-data changes or an empty diff/);
  }
  await writeFile(input, "src/generated/arkntools/operator-catalog.json\0");
  const { stdout } = await execFileAsync(process.execPath, [classifierPath, "--input", input, "--require-operator-data"]);
  assert.equal(JSON.parse(stdout).runBrowser, false);
});

test("empty, forced, and Windows-style inputs fail closed", () => {
  assertScope([], {
    scope: "full",
    reason: "empty-change-set",
    documentationOnly: false,
    runCore: true,
    runBrowser: true,
    deployRequired: true,
  });
  assertScope(["docs/guide.md"], {
    scope: "full",
    reason: "manual-or-unsupported-event",
    documentationOnly: false,
    runCore: true,
    runBrowser: true,
    deployRequired: true,
  }, { forceFull: true });
  assertScope([".\\src\\App.tsx"], {
    scope: "full",
    reason: "runtime-or-unclassified-change",
    documentationOnly: false,
    runCore: true,
    runBrowser: true,
    deployRequired: true,
  });
});

test("CLI reads NUL paths and writes stable GitHub outputs and summary", async (context) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "arkinfra-ci-scope-"));
  context.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  const inputPath = join(temporaryDirectory, "paths.zlist");
  const outputPath = join(temporaryDirectory, "github-output.txt");
  const summaryPath = join(temporaryDirectory, "summary.md");
  await writeFile(inputPath, Buffer.from("docs/计算逻辑.md\0.gitignore\0", "utf8"));

  const { stdout } = await execFileAsync(process.execPath, [
    classifierPath,
    "--input",
    inputPath,
    "--github-output",
    outputPath,
    "--summary",
    summaryPath,
  ]);
  const result = JSON.parse(stdout);
  assert.equal(result.scope, "documentation");
  assert.equal(
    await readFile(outputPath, "utf8"),
    [
      "scope=documentation",
      "reason=documentation-and-repository-metadata-only",
      "documentation_only=true",
      "run_core=false",
      "run_browser=false",
      "deploy_required=false",
      "",
    ].join("\n"),
  );
  assert.match(await readFile(summaryPath, "utf8"), /Changed paths \(2\)/);
});
