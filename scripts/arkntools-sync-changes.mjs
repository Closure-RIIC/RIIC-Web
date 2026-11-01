import { execFileSync } from "node:child_process";
import { appendFile, lstat, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const managedPaths = [
  "apps/arknights/public/images/operator-portraits",
  "apps/arknights/public/images/building-skills",
  "apps/arknights/public/images/products",
  "packages/arknights-domain/src/generated/arkntools",
  "apps/arknights/src/generated/mastery-data.json",
  "packages/arknights-domain/src/generated/gacha-up.json",
  "fixtures/operbox_full_e2.json",
  "apps/arknights/src/generated/i18n/zh-CN/ArknightsGameData.json",
  "apps/arknights/src/generated/i18n/zh-TW/ArknightsGameData.json",
  "apps/arknights/src/generated/i18n/en/ArknightsGameData.json",
  "apps/arknights/src/generated/i18n/operator-aliases.json",
  "apps/arknights/src/generated/i18n/sources.json",
];

const provenanceFields = new Map([
  ["apps/arknights/src/generated/i18n/sources.json", [
    ["source", "commit"],
    ["localInputs", "packages/arknights-domain/src/generated/arkntools/source.json"],
  ]],
  ["packages/arknights-domain/src/generated/arkntools/source.json", [
    ["source", "commit"], ["portraitsSource", "commit"], ["portraitsFallback", "commit"],
  ]],
  ["apps/arknights/src/generated/mastery-data.json", [
    ["source", "rules", "commit"], ["source", "branches", "commit"],
  ]],
]);
const ignoredCommit = Symbol("upstream commit");

function withoutUpstreamCommits(contents, fields) {
  const value = JSON.parse(contents);
  for (const keys of fields) {
    let parent = value;
    for (const key of keys.slice(0, -1)) parent = parent?.[key];
    const key = keys.at(-1);
    // Ignore only valid, existing provenance fields; schema/source changes still publish.
    const digestPattern = keys[0] === "localInputs" ? /^[0-9a-f]{64}$/i : /^[0-9a-f]{40}$/i;
    if (typeof parent?.[key] === "string" && digestPattern.test(parent[key])) {
      parent[key] = ignoredCommit;
    }
  }
  return value;
}

export function hasManagedContentChange(file, before, after) {
  const fields = provenanceFields.get(file);
  if (!fields || before === null || after === null) return true;
  return !isDeepStrictEqual(withoutUpstreamCommits(before, fields), withoutUpstreamCommits(after, fields));
}

export async function detectManagedChanges(root = process.cwd()) {
  const git = (...args) => execFileSync("git", args, {
    cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
  const changedFiles = [...new Set([
    ...git("diff", "--name-only", "--no-renames", "-z", "HEAD", "--", ...managedPaths).split("\0"),
    ...git("ls-files", "--others", "--exclude-standard", "-z", "--", ...managedPaths).split("\0"),
  ].filter(Boolean))].sort();
  const contentFiles = [], provenanceOnlyFiles = [];
  for (const file of changedFiles) {
    let contentChanged = true;
    if (provenanceFields.has(file)
      && git("ls-tree", "HEAD", "--", file).startsWith("100644 ")
      && !git("diff", "--summary", "--no-renames", "HEAD", "--", file).trim()) {
      const stat = await lstat(path.join(root, file));
      if (stat.isFile() && !stat.isSymbolicLink()) {
        contentChanged = hasManagedContentChange(file, git("show", `HEAD:${file}`), await readFile(path.join(root, file), "utf8"));
      }
    }
    (contentChanged ? contentFiles : provenanceOnlyFiles).push(file);
  }
  return { changed: contentFiles.length > 0, contentFiles, provenanceOnlyFiles };
}

async function main() {
  const result = await detectManagedChanges();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${result.changed}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const decision = result.changed
      ? "Managed content changed; publish the reviewed content and its current upstream provenance together."
      : "No managed content changed. Upstream commit-only updates do not create a resource PR or deployment.";
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Resource sync changes\n\n${decision}\n\nContent files: ${result.contentFiles.length}; provenance-only files: ${result.provenanceOnlyFiles.length}.\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
