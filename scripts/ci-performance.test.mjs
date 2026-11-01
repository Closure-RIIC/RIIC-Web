import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import test from "node:test";
import { URL } from "node:url";
import { classifyChanges } from "./ci-change-scope.mjs";

const read = relative => readFile(new URL("../" + relative, import.meta.url), "utf8");

test("the required PR gate accepts only complete checks or a verified documentation-only skip", async () => {
  const workflow = await read(".github/workflows/workspace-packages.yml");
  const gate = workflow.split("  packages:\n")[1];
  assert.ok(gate);
  assert.match(gate, /needs: \[changes, checks, runtime\]/);
  assert.match(gate, /if: always\(\)/);
  const script = gate.split("        run: |\n")[1].split("\n").map(line => line.replace(/^ {10}/, "")).join("\n");
  const gitExec = process.platform === "win32" ? spawnSync("git", ["--exec-path"], { encoding: "utf8" }).stdout.trim() : null;
  const gitBash = gitExec ? resolve(gitExec, "../../../bin/bash.exe") : null;
  const bash = process.env.TEST_BASH_PATH ?? (gitBash && existsSync(gitBash) ? gitBash : "bash");
  const run = values => spawnSync(bash, ["--noprofile", "--norc", "-c", script], { encoding: "utf8", windowsHide: true,
    env: { ...process.env, SCOPE_RESULT: "success", RUN_CORE: "true", CHECKS_RESULT: "success", RUNTIME_RESULT: "success", ...values } });
  assert.equal(run({}).status, 0);
  assert.equal(run({ RUN_CORE: "false", CHECKS_RESULT: "skipped", RUNTIME_RESULT: "skipped" }).status, 0);
  for (const status of ["failure", "cancelled", "skipped", ""]) {
    for (const field of ["SCOPE_RESULT", "CHECKS_RESULT", "RUNTIME_RESULT"]) assert.notEqual(run({ [field]: status }).status, 0, field + status);
  }
  assert.notEqual(run({ RUN_CORE: "" }).status, 0);
  assert.notEqual(run({ RUN_CORE: "false" }).status, 0);
  assert.equal(classifyChanges(["README.md", "docs/guide.md"]).runCore, false);
  assert.equal(classifyChanges(["docs/guide.md", "apps/arknights/src/app.tsx"]).runCore, true);
  assert.equal(classifyChanges([]).runCore, true);
});

test("PR path filters cannot strand required checks, and main runs never share a cancellation group", async () => {
  const pr = await read(".github/workflows/workspace-packages.yml");
  const release = await read(".github/workflows/frontend-quality.yml");
  assert.doesNotMatch(pr.split("  pull_request:\n")[1].split("  push:\n")[0], /paths/);
  assert.match(pr, /github\.event\.pull_request\.number \|\| github\.ref/);
  assert.match(pr, /cancel-in-progress: \$\{\{ github\.ref != 'refs\/heads\/main' \}\}/);
  assert.match(release, /group: post-merge-release-\$\{\{ github\.ref \}\}-\$\{\{ github\.run_id \}\}/);
  assert.match(release, /cancel-in-progress: false/);
});

test("every new parallel check still participates in the release gate", async () => {
  const release = await read(".github/workflows/frontend-quality.yml");
  const gate = release.split("  quality:\n")[1].split("  deploy:\n")[0];
  for (const job of ["static_checks", "lint_checks", "type_checks", "database_checks", "release_artifact", "browser_e2e", "browser_boundaries"]) {
    assert.ok(gate.includes("needs." + job + ".result"), job);
  }
  for (const result of ["STATIC", "LINT", "TYPES", "DATABASE", "BUILD"]) assert.ok(gate.includes('verify_result "$RUN_CORE" "$' + result + '_RESULT"'), result);
  for (const result of ["BROWSER_E2E", "BROWSER_BOUNDARIES"]) assert.ok(gate.includes('verify_result "$RUN_BROWSER" "$' + result + '_RESULT"'), result);
  const pr = await read(".github/workflows/workspace-packages.yml");
  for (const command of ["npm run check:types", "npm run lint", "npm run check:i18n", "npm run test:workspace",
    "npm run test:platform", "npm run test:endfield", "npm run test:endfield:skland", "npm run test:platform:integration",
    "npm run test:admin-preview", "test-endfield-changelog-e2e.mjs", "test-platform-runtime.mjs", "test-endfield-access.mjs",
    "endfield-deploy.test.py", "endfield-transfer.test.py", "stage-app-release.mjs --app endfield", "stage-app-release.mjs --app platform"]) {
    assert.ok(pr.includes(command), command);
  }
});
