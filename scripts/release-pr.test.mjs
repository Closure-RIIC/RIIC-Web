import assert from "node:assert/strict";
import test from "node:test";
import { parseOptions, ReleaseCommand, requiredChecksState } from "./release-pr.mjs";
import { RELEASE_REPOSITORY } from "./release-provenance.mjs";

const p = `/repos/${RELEASE_REPOSITORY}`;
const sha = Object.fromEntries(["head", "develop", "main", "devMerge", "release", "mainMerge"].map((key, i) => [key, String(i + 1).repeat(40)]));
const initialTree = "a".repeat(40), releaseTree = "b".repeat(40);
const repo = { full_name: RELEASE_REPOSITORY };
const options = { number: 17, execute: true, head: sha.head, approveProduction: true, timeoutMinutes: 90 };
const successCheck = name => ({ id: 1, name, app: { id: 15368 }, status: "completed", conclusion: "success" });

function fixture() {
  const source = { number: 17, title: "Reviewed change", state: "open", merged: false, draft: false, mergeable: true,
    base: { ref: "develop", repo }, head: { sha: sha.head, repo: { full_name: "contributor/fork" } }, labels: [] };
  const release = { number: 18, title: "Verified release", state: "open", merged: false, draft: false, mergeable: true,
    base: { ref: "main", repo }, head: { sha: sha.release, repo, ref: `release/automation/develop-${sha.devMerge}-${sha.main}` }, labels: [] };
  const branch = (value, tree) => ({ commit: { sha: value, commit: { tree: { sha: tree } } } });
  const branches = { develop: branch(sha.develop, initialTree), main: branch(sha.main, initialTree) };
  const run = (id, branch, value) => ({ id, run_attempt: 1, head_branch: branch, head_sha: value, repository: repo, head_repository: repo,
    path: ".github/workflows/frontend-quality.yml", event: "push", status: "completed", conclusion: "success", html_url: `https://github.com/${RELEASE_REPOSITORY}/actions/runs/${id}` });
  const runs = { develop: run(101, "develop", sha.devMerge), main: run(102, "main", sha.mainMerge) };
  const jobs = ["Change scope", "Repository hygiene", "Static and unit checks", "Database integration", "Build release once", "quality"]
    .map(name => ({ name, conclusion: "success" }));
  const pending = [{ environment: { name: "production", id: 99 }, current_user_can_approve: true }];
  const writes = [], verified = [];
  const f = { source, release, branches, runs, jobs, pending, writes, verified, checks: [successCheck("packages"), successCheck("Release branch only")], intercept: () => undefined };
  const api = async (path, request = {}) => {
    const intercepted = f.intercept(path, request);
    if (intercepted !== undefined) return intercepted;
    if (request.method && request.method !== "GET") {
      writes.push({ path, ...request });
      if (path === `${p}/pulls/17/merge` || path === `${p}/pulls/18/merge`) {
        const isSource = path.includes("/17/");
        const pr = isSource ? source : release;
        assert.equal(request.body.sha, pr.head.sha);
        assert.equal(request.body.merge_method, "merge");
        const value = isSource ? sha.devMerge : sha.mainMerge;
        pr.merged = true; pr.state = "closed"; pr.merge_commit_sha = value;
        branches[isSource ? "develop" : "main"] = branch(value, releaseTree);
        return { merged: true, sha: value };
      }
      if (path.endsWith("/102/pending_deployments")) { runs.main.status = "completed"; runs.main.conclusion = "success"; return []; }
      if (path.endsWith("/dispatches")) return null;
      throw new Error(`Unexpected write: ${path}`);
    }
    if (path === `${p}/pulls/17`) return source;
    if (path === `${p}/pulls/18`) return release;
    for (const name of ["develop", "main"]) {
      if (path === `${p}/branches/${name}`) return branches[name];
      if (path === `${p}/git/ref/heads/${name}`) return { object: { sha: branches[name].commit.sha } };
      if (path === `${p}/branches/${name}/protection/required_status_checks`) return { checks: [{ context: "packages", app_id: 15368 }, ...(name === "main" ? [{ context: "Release branch only", app_id: 15368 }] : [])] };
    }
    if (path.includes("/check-runs?")) return { check_runs: f.checks };
    if (path.includes("/commits/") && path.includes("/statuses?")) return [];
    if (path.includes("/actions/variables/")) return { value: "1" };
    if (path.includes("/actions/workflows/frontend-quality.yml/runs?")) return { workflow_runs: [runs[path.includes("branch=develop") ? "develop" : "main"]] };
    if (path.includes("/jobs?")) return { total_count: jobs.length, jobs };
    if (path === `${p}/actions/runs/101`) return runs.develop;
    if (path === `${p}/actions/runs/102`) return runs.main;
    if (path === `${p}/actions/runs/101/pending_deployments`) return [];
    if (path === `${p}/actions/runs/102/pending_deployments`) return pending;
    if (path.includes("/pulls?state=open&base=main")) return release.merged ? [] : [release];
    if (path === `${p}/git/commits/${sha.release}`) return { tree: { sha: releaseTree } };
    if (path.includes("/compare/")) return { status: "ahead" };
    throw new Error(`Unexpected read: ${path}`);
  };
  let now = 0;
  f.command = new ReleaseCommand({ api, now: () => now, sleep: async ms => { now += ms; }, log: () => {},
    verifyApps: async (branch, value) => { verified.push({ branch, sha: value }); return { arknights: value, endfield: value }; } });
  return f;
}

test("preview is read only; execution requires a reviewed exact head and a valid repository PR", async () => {
  assert.equal(parseOptions(["https://github.com/Closure-RIIC/RIIC-Web/pull/17"]).number, 17);
  for (const args of [["17", "--execute"], ["17", "--approve-production"], ["https://github.com/other/repo/pull/17"], ["17", "--timeout-minutes", "0"], ["17", "--unknown"]]) assert.throws(() => parseOptions(args));
  const f = fixture();
  const plan = await f.command.run({ ...options, execute: false });
  assert.equal(plan.head, sha.head);
  assert.equal(plan.pendingDevelop, false);
  assert.deepEqual(f.writes, []);
});

test("normal two-environment release pins merge heads and verifies each deployed application", async () => {
  const f = fixture();
  const result = await f.command.run(options);
  assert.equal(result.development.sha, sha.devMerge);
  assert.equal(result.production.sha, sha.mainMerge);
  assert.deepEqual(f.writes.map(write => write.path), [`${p}/pulls/17/merge`, `${p}/pulls/18/merge`]);
  assert.deepEqual(f.verified, [{ branch: "develop", sha: sha.devMerge }, { branch: "main", sha: sha.mainMerge }]);
  await f.command.run(options);
  assert.equal(f.writes.length, 2, "resuming a finished release must not merge or dispatch again");
});

test("production approval needs an explicit flag and resumes without repeating merges", async () => {
  const f = fixture();
  Object.assign(f.runs.main, { status: "waiting", conclusion: null });
  await assert.rejects(f.command.run({ ...options, approveProduction: false }), /Production awaits approval/);
  assert.equal(f.writes.length, 2);
  await f.command.run(options);
  assert.equal(f.writes.length, 3);
  assert.deepEqual(f.writes[2].body.environment_ids, [99]);
  assert.equal(f.writes[2].body.state, "approved");
});

test("permission, environment and quality failures never submit approval", async () => {
  for (const mutate of [f => { f.pending[0].current_user_can_approve = false; }, f => { f.pending[0].environment.name = "other"; }, f => { f.jobs.find(job => job.name === "quality").conclusion = "failure"; }]) {
    const f = fixture();
    Object.assign(f.runs.main, { status: "waiting", conclusion: null });
    mutate(f);
    await assert.rejects(f.command.run(options));
    assert.ok(f.writes.every(write => !write.path.endsWith("/pending_deployments")));
  }
});

test("changed PR heads, conflicting or stale branches and failed CI stop before merge", async () => {
  for (const mutate of [f => { f.source.head.sha = "f".repeat(40); }, f => { f.source.mergeable = false; }, f => { f.source.mergeable_state = "behind"; }, f => { f.checks[0].conclusion = "failure"; }, f => {
    f.intercept = path => path === `${p}/git/ref/heads/develop` ? { object: { sha: "f".repeat(40) } } : undefined;
  }]) {
    const f = fixture(); mutate(f);
    await assert.rejects(f.command.run(options));
    assert.deepEqual(f.writes, []);
  }
});

test("unpublished develop changes require an explicit scope expansion", async () => {
  const f = fixture(); f.branches.develop.commit.commit.tree.sha = "c".repeat(40);
  await assert.rejects(f.command.run(options), /other unpublished changes/);
  assert.deepEqual(f.writes, []);
  await f.command.run({ ...options, includeDevelop: true });
  assert.equal(f.writes.length, 2);
});

test("failed or wrong-identity workflows never promote to main or silently retry", async () => {
  for (const mutate of [f => { f.runs.develop.conclusion = "failure"; }, f => { f.runs.develop.head_sha = sha.head; }, f => { f.runs.develop.head_repository = { full_name: "other/repo" }; }, f => { f.runs.develop.path = ".github/workflows/other.yml"; }]) {
    const f = fixture(); mutate(f);
    await assert.rejects(f.command.run(options));
    assert.deepEqual(f.writes.map(write => write.path), [`${p}/pulls/17/merge`]);
  }
});

test("a green workflow with an undeployed application is not release success", async () => {
  const f = fixture(); f.command.verifyApps = async () => { throw new Error("Endfield still pending"); };
  await assert.rejects(f.command.run(options), /Endfield still pending/);
  assert.equal(f.writes.length, 1);
});

test("unexpected release content or missing ancestry prevents the main merge", async () => {
  for (const intercept of [path => path.includes("/git/commits/") ? { tree: { sha: initialTree } } : undefined,
    path => path.includes("/compare/") ? { status: "diverged" } : undefined]) {
    const f = fixture(); f.intercept = intercept;
    await assert.rejects(f.command.run(options));
    assert.equal(f.writes.length, 1);
  }
});

test("newer check attempts supersede old failures, while foreign App checks do not satisfy gates", () => {
  const required = { checks: [{ context: "packages", app_id: 15368 }] };
  assert.deepEqual(requiredChecksState(required, [{ ...successCheck("packages"), conclusion: "failure" }, { ...successCheck("packages"), id: 2 }], []), []);
  assert.deepEqual(requiredChecksState(required, [{ ...successCheck("packages"), app: { id: 99 } }], [{ context: "packages", state: "success" }]), ["packages"]);
});

test("missing push event dispatches at most one exact-SHA release, then times out resumably", async () => {
  const f = fixture(); f.intercept = path => path.includes("/actions/workflows/frontend-quality.yml/runs?") ? { workflow_runs: [] } : undefined;
  await assert.rejects(f.command.run({ ...options, timeoutMinutes: 2 }), /Timed out/);
  const dispatches = f.writes.filter(write => write.path.endsWith("/dispatches"));
  assert.equal(dispatches.length, 1);
  assert.deepEqual(dispatches[0].body, { ref: "develop", inputs: { deploy: "true", expected_sha: sha.devMerge, run_webkit: "false" } });
});
