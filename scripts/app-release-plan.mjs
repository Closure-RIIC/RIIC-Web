import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { classifyChanges } from "./ci-change-scope.mjs";
import { deploymentBaseline, githubApi, RELEASE_REPOSITORY } from "./release-provenance.mjs";

export const APPLICATIONS = ["arknights", "endfield"];
// These packages also contain Arknights-only implementation. Endfield consumes
// only these export leaves. The import-boundary regression test fails closed if
// another consumer or transitive import expands this set.
export const ENDFIELD_SHARED_LEAVES = {
  "packages/arknights-domain": ["src/account-name.ts", "src/password-strength.ts", "src/i18n/localize.ts", "src/i18n/config.ts", "src/releases/types.ts", "src/releases/validation.ts"],
  "packages/platform-server": ["src/proxy.ts", "src/html-compression.ts"],
};
const shaPattern = /^[a-f0-9]{40}$/;
const ordered = (values) => APPLICATIONS.filter((app) => values.has(app));
const dependencyNames = (manifest) => Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies });

// Read both revisions: removing a dependency, workspace or import must still
// invalidate its former consumers. Unknown paths always affect both apps.
export function workspaceConsumers(manifests) {
  const byName = new Map(Object.entries(manifests).map(([directory, manifest]) => [manifest.name, { directory, manifest }]));
  const consumers = new Map();
  for (const app of APPLICATIONS) {
    const seen = new Set();
    const visit = (name) => {
      if (seen.has(name)) return;
      seen.add(name);
      const entry = byName.get(name);
      if (!entry) return;
      if (!consumers.has(entry.directory)) consumers.set(entry.directory, new Set());
      consumers.get(entry.directory).add(app);
      for (const dependency of dependencyNames(entry.manifest)) visit(dependency);
    };
    assert.ok(byName.has(`@riic/${app}`), `Missing application manifest: ${app}`);
    visit(`@riic/${app}`);
  }
  return consumers;
}

function lockClosure(lock, manifests, app) {
  assert.equal(lock.lockfileVersion, 3);
  const entries = lock.packages;
  assert.ok(entries?.[""] && entries[`apps/${app}`]);
  const result = {};
  const visit = (location) => {
    if (Object.hasOwn(result, location)) return;
    const entry = entries[location];
    assert.ok(entry, `Missing lock entry: ${location}`);
    result[location] = entry;
    if (entry.link) { visit(entry.resolved); return; }
    for (const name of dependencyNames(entry)) {
      // Resolve npm's nested and hoisted package locations, closest first.
      let parent = location;
      let found;
      while (true) {
        const candidate = `${parent ? `${parent}/` : ""}node_modules/${name}`;
        if (entries[candidate]) { found = candidate; break; }
        if (!parent) break;
        parent = parent.includes("/") ? parent.slice(0, parent.lastIndexOf("/")) : "";
      }
      if (found) visit(found);
      else assert.ok(entry.peerDependenciesMeta?.[name]?.optional || entry.optionalDependencies?.[name], `Unresolved dependency: ${name}`);
    }
  };
  // Root build tooling is shared; application dependencies remain independent.
  visit("");
  visit(`apps/${app}`);
  for (const [directory, apps] of workspaceConsumers(manifests)) if (apps.has(app)) visit(directory);
  return JSON.stringify(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

export function classifyAppChanges(paths, { beforeManifests, afterManifests, beforeLock, afterLock }) {
  const maps = [workspaceConsumers(beforeManifests), workspaceConsumers(afterManifests)];
  const check = new Set(), deploy = new Set();
  const reasons = [];
  for (const rawPath of new Set(paths)) {
    const file = rawPath.replaceAll("\\", "/").replace(/^\.\//, "");
    const scope = classifyChanges([file]);
    if (scope.documentationOnly) continue;
    let apps = new Set();
    const directory = file.match(/^(apps|packages|services)\/[^/]+\//)?.[0].slice(0, -1);
    if (file.startsWith("apps/arknights/")) apps.add("arknights");
    else if (file.startsWith("apps/endfield/")) apps.add("endfield");
    else if (directory) for (const map of maps) for (const app of map.get(directory) ?? []) apps.add(app);
    if (file === "package-lock.json" && beforeLock && afterLock) {
      try {
        apps = new Set(APPLICATIONS.filter((app) => lockClosure(beforeLock, beforeManifests, app) !== lockClosure(afterLock, afterManifests, app)));
      } catch { apps = new Set(APPLICATIONS); }
    } else if (!apps.size) apps = new Set(APPLICATIONS);
    if (directory && file.startsWith(`${directory}/src/`) && ENDFIELD_SHARED_LEAVES[directory] &&
      !ENDFIELD_SHARED_LEAVES[directory].some((leaf) => file === `${directory}/${leaf}`)) apps.delete("endfield");
    if (directory === "packages/platform-server") check.add("endfield");
    if (/^(scripts\/(?:deploy-endfield|pack-endfield-release)\.sh|deploy\/(?:endfield-|setup-endfield-))/.test(file)) apps = new Set(["endfield"]);
    if (/^scripts\/(?:build-worker|plan-worker|prepare-standalone|stage-standalone-release)\./.test(file)) apps = new Set(["arknights"]);
    for (const app of apps) {
      check.add(app);
      if (scope.deployRequired) deploy.add(app);
    }
    // Endfield's account and Skland APIs are hosted by the Arknights service.
    // Verify both clients, but do not restart the Endfield frontend for API-only changes.
    if (/^apps\/arknights\/src\/routes\/api\.(?:auth|platform|endfield|skland)/.test(file)) check.add("endfield");
    reasons.push({ path: file, checkApps: ordered(apps), deployApps: scope.deployRequired ? ordered(apps) : [] });
  }
  return { checkApps: ordered(check), deployApps: ordered(deploy), reasons };
}

export async function createReleasePlan({ head, before, baselines, diff, snapshot, forceFull = false, operatorDataBase = "" }) {
  assert.match(head, shaPattern);
  const current = snapshot(head);
  const impact = (base, paths) => classifyAppChanges(paths, {
    beforeManifests: snapshot(base).manifests, afterManifests: current.manifests,
    beforeLock: snapshot(base).lock, afterLock: current.lock,
  });
  let validationPaths = [];
  let full = forceFull;
  if (before) {
    try { validationPaths = diff(before, head); } catch { full = true; }
  } else full = true;
  const deployApps = [], applications = {};
  for (const app of APPLICATIONS) {
    const base = baselines[app] ?? "";
    let paths = [], required = true, reason = "missing-or-unusable-baseline";
    try {
      assert.match(base, shaPattern);
      paths = diff(base, head);
      const changes = impact(base, paths);
      required = changes.deployApps.includes(app);
      reason = required ? "application-inputs-changed" : "application-unchanged";
      // Missed deployments remain in validation even after a docs-only push.
      validationPaths.push(...changes.reasons.filter((item) => item.deployApps.includes(app)).map((item) => item.path));
    } catch { full = true; }
    if (required) deployApps.push(app);
    applications[app] = { baseSha: base, deployRequired: required, reason, changedFiles: paths };
  }
  if (operatorDataBase) {
    const operatorPaths = diff(operatorDataBase, head);
    assert.equal(classifyChanges(operatorPaths).scope, "operator-data", "Operator-data release includes non-data changes or an empty diff");
    // This hint may narrow checks only when it also covers every pending release.
    if (!full && validationPaths.every((file) => operatorPaths.includes(file))) validationPaths = operatorPaths;
  }
  validationPaths = [...new Set(validationPaths)].sort();
  const scope = validationPaths.length || full
    ? classifyChanges(validationPaths, { forceFull: full })
    : { scope: "unchanged", reason: "no-pending-changes", documentationOnly: true, runCore: false, runBrowser: false };
  // Keep existing required checks intact in this rollout. Builds needed by those
  // checks are deliberately broader than deployment; a test is never permission to deploy.
  const checkApps = scope.runCore ? [...APPLICATIONS] : [];
  const affected = full ? [...APPLICATIONS] : impact(before || head, validationPaths).checkApps;
  const buildApps = ordered(new Set([...deployApps, ...affected, ...(scope.runBrowser ? ["arknights"] : [])]));
  return { formatVersion: 1, headSha: head, ...scope, deployRequired: deployApps.length > 0, checkApps, buildApps, deployApps, applications };
}

export function gitRepository(cwd = process.cwd()) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  const cache = new Map();
  return {
    diff(base, head) {
      assert.match(base, shaPattern); assert.match(head, shaPattern);
      git("merge-base", "--is-ancestor", base, head);
      return git("diff", "--name-only", "--no-renames", "-z", `${base}..${head}`).split("\0").filter(Boolean);
    },
    snapshot(ref) {
      assert.match(ref, shaPattern);
      if (!cache.has(ref)) {
        const manifests = {};
        for (const file of git("ls-tree", "-r", "--name-only", ref, "apps", "packages", "services").split("\n")) {
          if (/^(apps|packages|services)\/[^/]+\/package\.json$/.test(file)) manifests[file.slice(0, -13)] = JSON.parse(git("show", `${ref}:${file}`));
        }
        cache.set(ref, { manifests, lock: JSON.parse(git("show", `${ref}:package-lock.json`)) });
      }
      return cache.get(ref);
    },
  };
}

async function main() {
  const env = process.env;
  assert.equal(env.GITHUB_REPOSITORY, RELEASE_REPOSITORY);
  const api = githubApi(env.GH_TOKEN);
  const baselines = {};
  for (const app of APPLICATIONS) {
    try { baselines[app] = await deploymentBaseline({ api, repository: env.GITHUB_REPOSITORY, branch: env.GITHUB_REF_NAME, application: app }); }
    catch { process.stderr.write(`${app}: deployment history unavailable; full validation selected.\n`); }
  }
  const plan = await createReleasePlan({
    ...gitRepository(), head: env.GITHUB_SHA, before: env.PUSH_BEFORE_SHA || env.GITHUB_SHA,
    baselines, forceFull: env.GITHUB_EVENT_NAME !== "push" && !env.OPERATOR_DATA_BASE_SHA, operatorDataBase: env.OPERATOR_DATA_BASE_SHA || "",
  });
  const outputs = {
    scope: plan.scope, reason: plan.reason, documentation_only: plan.documentationOnly,
    run_core: plan.runCore, run_browser: plan.runBrowser, deploy_required: plan.deployRequired,
    check_apps: JSON.stringify(plan.checkApps), build_apps: JSON.stringify(plan.buildApps), deploy_apps: JSON.stringify(plan.deployApps),
  };
  for (const app of APPLICATIONS) {
    outputs[`deploy_${app}`] = plan.deployApps.includes(app);
    outputs[`build_${app}`] = plan.buildApps.includes(app);
  }
  await appendFile(env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(""));
  await appendFile(env.GITHUB_STEP_SUMMARY, `### Application release plan\n\nChecks: ${plan.checkApps.join(", ") || "none"}; builds: ${plan.buildApps.join(", ") || "none"}; deploys: ${plan.deployApps.join(", ") || "none"}.\n\n| Application | Last success | Deploy | Reason |\n| --- | --- | --- | --- |\n${APPLICATIONS.map((app) => `| ${app} | ${plan.applications[app].baseSha || "unknown"} | ${plan.applications[app].deployRequired} | ${plan.applications[app].reason} |`).join("\n")}\n`);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
