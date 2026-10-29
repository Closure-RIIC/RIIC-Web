import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { messageGitHistory, pathBatches } from "./git-history.mjs";

test("resource path batches stay below the Windows command-line limit", () => {
  const paths = Array.from({ length: 1000 }, (_, i) => `${"folder/".repeat(10)}${i}.json`);
  const batches = pathBatches(paths);
  assert.deepEqual(batches.flat(), paths);
  assert.ok(batches.length > 1);
  assert.ok(batches.every(batch => batch.reduce((size, file) => size + file.length + 16, 0) <= 12000));
});

test("semantic history ignores formatting, follows renames and retains HEAD for local edits", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "riic-i18n-history-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
  git("init"); git("config", "user.email", "fixture@example.test"); git("config", "user.name", "Fixture");
  const commit = (message, seconds) => {
    git("add", ".");
    execFileSync("git", ["commit", "-m", message], { cwd: root, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_DATE: `2026-01-01T00:00:${seconds}Z`, GIT_COMMITTER_DATE: `2026-01-01T00:00:${seconds}Z` } });
    return git("rev-parse", "HEAD");
  };
  await fs.writeFile(path.join(root, "zh-CN.json"), JSON.stringify({ title: "初版" }));
  await fs.writeFile(path.join(root, "en.json"), JSON.stringify({ title: "First" }));
  const first = commit("initial", "00");
  await fs.writeFile(path.join(root, "zh-CN.json"), JSON.stringify({ title: "新版" }));
  const second = commit("source changed", "10");
  await fs.writeFile(path.join(root, "en.json"), JSON.stringify({ title: "First" }, null, 2));
  commit("format", "20");
  git("mv", "en.json", "translated-en.json"); commit("rename", "30");
  await fs.writeFile(path.join(root, "translated-en.json"), JSON.stringify({ title: "Uncommitted" }));
  const result = await messageGitHistory.load({ host: { root }, resources: [{ path: "zh-CN.json", locale: "zh-CN" }, { path: "translated-en.json", locale: "en" }], messagesIn: (_resource, text) => new Map(Object.entries(JSON.parse(text))) });
  assert.equal(result.changes.get("title").get("zh-CN").revision, second);
  assert.equal(result.changes.get("title").get("en").revision, first);
  assert.equal(result.changes.get("title").get("en").value, "First");
  assert.equal(result.valueAt("title", "zh-CN", Date.parse("2026-01-01T00:00:05Z")), "初版");
});
