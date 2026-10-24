import assert from "node:assert/strict";
import test from "node:test";
import { configureAutoMerge, eligiblePullRequest, promoteRelease, promotionQualityRun, requestedPullNumbers } from "./release-automation.mjs";
import { RELEASE_REPOSITORY } from "./release-provenance.mjs";

const prefix = `/repos/${RELEASE_REPOSITORY}`;
const sha = "a".repeat(40), mainSha = "b".repeat(40), mergedSha = "c".repeat(40);
const bot = "riic-release[bot]";
function pull() {
  return { number: 9, state: "open", draft: false, merged: false, labels: [{ name: "automerge" }],
    head: { sha, ref: "feature/endfield", repo: { full_name: RELEASE_REPOSITORY } },
    base: { ref: "develop", repo: { full_name: RELEASE_REPOSITORY } }, user: { login: "maintainer" } };
}

test("workflow-run requests require the trusted metadata source and reject fork runs", async () => {
  const event = { workflow_run: { path: ".github/workflows/pr-automation-request.yml", event: "pull_request", conclusion: "success",
    head_repository: { full_name: RELEASE_REPOSITORY }, head_sha: sha, head_branch: "feature/endfield", pull_requests: [{ number: 9 }] } };
  const api = async (url) => { assert.match(url, /head=Closure-RIIC%3Afeature%2Fendfield/); return [pull()]; };
  assert.deepEqual(await requestedPullNumbers(api, event), [9]);
  event.workflow_run.pull_requests = [];
  assert.deepEqual(await requestedPullNumbers(api, event), [9]);
  for (const override of [{ path: ".github/workflows/other.yml" }, { event: "push" }, { conclusion: "failure" }, { head_repository: { full_name: "foreign/repo" } }]) {
    await assert.rejects(requestedPullNumbers(api, { workflow_run: { ...event.workflow_run, ...override } }));
  }
});

test("automatic merges are opt-in, same-repository, non-draft and use the release lane", () => {
  const pr = pull();
  assert.equal(eligiblePullRequest(pr), true);
  for (const change of [
    { draft: true }, { state: "closed" }, { merged: true },
    { head: { ...pr.head, repo: { full_name: "foreign/repo" } } },
    { base: { ...pr.base, ref: "main" } },
    { base: { ...pr.base, ref: "other" } },
  ]) assert.equal(eligiblePullRequest({ ...pr, ...change }), false);
  pr.head.ref = "release/test"; pr.base.ref = "main";
  assert.equal(eligiblePullRequest(pr), true);
  pr.labels.push({ name: "direct-main-release" });
  assert.equal(eligiblePullRequest(pr), false);
});

test("label authorization and exact PR head are checked before enabling native auto-merge", async () => {
  const pr = pull(), merges = [];
  let permission = "write", allowed = true, reads = 0, changeHead = false;
  const api = async (url) => {
    if (url === `${prefix}/pulls/9`) { reads++; return { ...pr, head: { ...pr.head, sha: changeHead && reads % 2 === 0 ? mainSha : sha } }; }
    if (url.includes("/issues/9/events?")) return [{ event: "labeled", label: { name: "automerge" }, actor: { login: "maintainer" } }];
    if (url.endsWith("/permission")) return { permission };
    if (url === prefix) return { allow_auto_merge: allowed };
    throw new Error(url);
  };
  const options = { api, number: 9, merge: (...args) => merges.push(args), appBotLogin: bot };
  assert.equal(await configureAutoMerge(options), "enabled");
  assert.deepEqual(merges, [[9, sha, true]]);
  permission = "triage";
  await assert.rejects(configureAutoMerge(options), /Only a maintainer/);
  permission = "write"; allowed = false;
  await assert.rejects(configureAutoMerge(options), /administrator/);
  allowed = true; reads = 0; changeHead = true;
  assert.equal(await configureAutoMerge(options), "changed");
  assert.equal(merges.length, 1);
  pr.labels = []; pr.auto_merge = { enabled_by: { login: bot } }; changeHead = false;
  assert.equal(await configureAutoMerge(options), "not-opted-in");
  assert.deepEqual(merges.at(-1), [9, sha, false]);
});

function promotionFixture() {
  const writes = [];
  let branchCreated = false, pullCreated = false;
  const releaseBranch = `release/automation/develop-${sha}-${mainSha}`;
  const pr = { ...pull(), user: { login: bot }, head: { sha: mergedSha, ref: releaseBranch, repo: { full_name: RELEASE_REPOSITORY } }, base: { ref: "main" } };
  const run = { id: 123, repository: { id: 42, full_name: RELEASE_REPOSITORY }, head_repository: { full_name: RELEASE_REPOSITORY },
    path: ".github/workflows/frontend-quality.yml", event: "push", head_branch: "develop", head_sha: sha, status: "completed", conclusion: "success", run_attempt: 1 };
  const jobs = ["Change scope", "Repository hygiene", "Static and unit checks", "Database integration", "Build release once", "quality"].map((name) => ({ name, conclusion: "success" }));
  const manifests = { "apps/arknights": { name: "@riic/arknights" }, "apps/endfield": { name: "@riic/endfield" } };
  const f = { endfieldHealthy: true, developSha: sha, mainTree: "old-tree", parents: [mainSha, sha], ancestry: "ahead", run, jobs, writes, pr };
  const api = async (url, options) => {
    if (options?.method) {
      writes.push({ url, ...options });
      if (url.endsWith("/git/refs")) { branchCreated = true; return {}; }
      if (url.endsWith("/pulls")) { pullCreated = true; return pr; }
      return {};
    }
    if (url.endsWith("/branches/develop")) return { commit: { sha: f.developSha, commit: { tree: { sha: "dev-tree" } } } };
    if (url.endsWith("/branches/main")) return { commit: { sha: mainSha, commit: { tree: { sha: f.mainTree } } } };
    if (url.endsWith("/actions/runs/123")) return run;
    if (url.includes("/actions/workflows/frontend-quality.yml/runs?")) return { workflow_runs: [{ id: 123 }] };
    if (url.includes("/attempts/1/jobs?")) return { total_count: jobs.length, jobs };
    if (url.includes("/deployments?")) {
      const app = url.includes("deploy:arknights") ? "arknights" : "endfield";
      return [{ id: app === "arknights" ? 1 : 2, environment: "development", task: `deploy:${app}`, sha,
        payload: { formatVersion: 1, application: app, branch: "develop" } }];
    }
    if (url.includes("/statuses?")) return [{ state: url.includes("/2/") && !f.endfieldHealthy ? "failure" : "success" }];
    if (url.includes("/git/matching-refs/")) return branchCreated ? [{ ref: `refs/heads/${releaseBranch}` }] : [];
    if (url.includes("/git/ref/heads/")) return { object: { sha: mergedSha } };
    if (url.includes("/git/commits/")) return { parents: f.parents.map((sha) => ({ sha })) };
    if (url.endsWith(`/compare/${mainSha}...${sha}`)) return { status: f.ancestry };
    if (url.includes("/compare/")) return { status: "ahead" };
    if (url.includes("/pulls?")) return pullCreated ? [pr] : [];
    throw new Error(url);
  };
  f.options = { api, sha, verifiedRunId: "123", appBotLogin: bot, repository: { snapshot: () => ({ manifests }), diff: () => [] } };
  return f;
}

test("promotion waits for every affected development deployment and required quality check", async () => {
  const f = promotionFixture();
  f.endfieldHealthy = false;
  await assert.rejects(promoteRelease(f.options), /undeployed application/);
  assert.equal(f.writes.length, 0);
  f.endfieldHealthy = true; f.jobs.at(-1).conclusion = "failure";
  await assert.rejects(promoteRelease(f.options), /Required job/);
  assert.equal(f.writes.length, 0);
  f.jobs.at(-1).conclusion = "success"; f.developSha = mainSha;
  assert.deepEqual(await promoteRelease(f.options), { skipped: "develop-advanced" });
  assert.equal(f.writes.length, 0);
});

test("successful independent retries resume promotion using the original exact-commit quality proof", async () => {
  const f = promotionFixture(); f.run.conclusion = "failure";
  const retry = { ...f.run, id: 456, path: ".github/workflows/deploy-verified.yml", conclusion: "success" };
  assert.equal(await promotionQualityRun(f.options.api, retry), 123);
  f.jobs.at(-1).conclusion = "failure";
  await assert.rejects(promotionQualityRun(f.options.api, retry), /No exact-commit quality proof/);
  await assert.rejects(promotionQualityRun(f.options.api, { ...retry, head_branch: "main" }));
  await assert.rejects(promotionQualityRun(f.options.api, { ...retry, head_repository: { full_name: "foreign/repo" } }));
});

test("promotion creates an ancestry-preserving PR idempotently without force pushes", async () => {
  const f = promotionFixture();
  const result = await promoteRelease(f.options);
  assert.equal(result.number, 9);
  const merge = f.writes.find((write) => write.url.endsWith("/merges"));
  assert.equal(merge.body.head, sha);
  assert.ok(merge.body.base.startsWith("release/"));
  const created = f.writes.find((write) => write.url.endsWith("/pulls"));
  assert.equal(created.body.base, "main");
  assert.match(created.body.body, /production environment approval/);
  await promoteRelease(f.options);
  assert.equal(f.writes.filter((write) => write.url.endsWith("/pulls")).length, 1);
  assert.equal(f.writes.filter((write) => write.url.endsWith("/git/refs")).length, 1);
  assert.equal(f.writes.some((write) => write.body.force), false);
});

test("identical trees do not create empty promotion PRs", async () => {
  const f = promotionFixture(); f.mainTree = "dev-tree";
  assert.deepEqual(await promoteRelease(f.options), { skipped: "same-tree" });
  assert.equal(f.writes.length, 0);
});

test("promotion rejects a modified automation branch and skips already promoted commits", async () => {
  const f = promotionFixture();
  f.parents = [mainSha, mergedSha, sha];
  await assert.rejects(promoteRelease(f.options), /changed outside automation/);
  assert.equal(f.writes.some((write) => write.url.endsWith("/pulls")), false);
  const promoted = promotionFixture(); promoted.ancestry = "behind";
  assert.deepEqual(await promoteRelease(promoted.options), { skipped: "already-promoted" });
  assert.equal(promoted.writes.length, 0);
});
