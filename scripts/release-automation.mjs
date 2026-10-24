import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { APPLICATIONS, createReleasePlan, gitRepository } from "./app-release-plan.mjs";
import { deploymentBaseline, githubApi, RELEASE_REPOSITORY, verifyQualityRun } from "./release-provenance.mjs";

const prefix = `/repos/${RELEASE_REPOSITORY}`;
const shaPattern = /^[a-f0-9]{40}$/;
const label = "automerge";
const releasePrefix = "release/automation/develop-";

async function list(api, path) {
  const result = [];
  for (let page = 1; page <= 20; page += 1) {
    const items = await api(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    assert.ok(Array.isArray(items));
    result.push(...items);
    if (items.length < 100) return result;
  }
  throw new Error("Automation metadata pagination exceeded its limit");
}

export function eligiblePullRequest(pr) {
  return pr.state === "open" && !pr.draft && !pr.merged &&
    pr.base?.repo?.full_name === RELEASE_REPOSITORY && pr.head?.repo?.full_name === RELEASE_REPOSITORY &&
    shaPattern.test(pr.head.sha) && (pr.base.ref === "develop" ||
      (pr.base.ref === "main" && pr.head.ref.startsWith("release/") && !pr.labels.some((item) => item.name === "direct-main-release")));
}

export async function requestedPullNumbers(api, event) {
  const run = event.workflow_run;
  if (!run) return [event.inputs?.pr_number];
  assert.equal(run.path, ".github/workflows/pr-automation-request.yml");
  assert.equal(run.event, "pull_request");
  assert.equal(run.conclusion, "success");
  assert.equal(run.head_repository?.full_name, RELEASE_REPOSITORY);
  assert.match(run.head_sha, shaPattern);
  if (run.pull_requests?.length) return run.pull_requests.map((pr) => pr.number);
  // GitHub sometimes omits associated PRs from workflow_run. Resolve them from
  // repository metadata instead of accepting an artifact written by PR code.
  assert.ok(typeof run.head_branch === "string" && run.head_branch.length > 0 && run.head_branch.length < 256);
  const head = encodeURIComponent(`${RELEASE_REPOSITORY.split("/")[0]}:${run.head_branch}`);
  const pulls = await list(api, `${prefix}/pulls?state=open&head=${head}`);
  return pulls.filter((pr) => pr.head.repo?.full_name === RELEASE_REPOSITORY && pr.head.ref === run.head_branch).map((pr) => pr.number);
}

export async function promotionQualityRun(api, run) {
  assert.ok([".github/workflows/frontend-quality.yml", ".github/workflows/deploy-verified.yml"].includes(run.path));
  assert.equal(run.head_branch, "develop");
  assert.equal(run.conclusion, "success");
  assert.equal(run.repository?.full_name, RELEASE_REPOSITORY);
  assert.equal(run.head_repository?.full_name, RELEASE_REPOSITORY);
  assert.match(run.head_sha, shaPattern);
  if (run.path === ".github/workflows/frontend-quality.yml") return run.id;
  // Independent retries are separate runs. Recover the original exact-commit
  // quality proof from GitHub, including a run whose deployment sibling failed.
  const candidates = await api(`${prefix}/actions/workflows/frontend-quality.yml/runs?branch=develop&head_sha=${run.head_sha}&per_page=100`);
  assert.ok(Array.isArray(candidates.workflow_runs));
  for (const candidate of candidates.workflow_runs) {
    try {
      await verifyQualityRun({ api, repository: RELEASE_REPOSITORY, branch: "develop", sha: run.head_sha, runId: candidate.id });
      return candidate.id;
    } catch { /* A cancelled or incomplete candidate is not quality proof. */ }
  }
  throw new Error("No exact-commit quality proof found after deployment retry");
}

export async function configureAutoMerge({ api, number, merge, appBotLogin }) {
  assert.match(String(number), /^[1-9][0-9]*$/);
  const pr = await api(`${prefix}/pulls/${number}`);
  if (!eligiblePullRequest(pr)) return "ineligible";
  if (!pr.labels.some((item) => item.name === label)) {
    if (pr.auto_merge?.enabled_by?.login === appBotLogin) await merge(number, pr.head.sha, false);
    return "not-opted-in";
  }
  const events = await list(api, `${prefix}/issues/${number}/events`);
  const lastLabelEvent = events.filter((event) => ["labeled", "unlabeled"].includes(event.event) && event.label?.name === label).at(-1);
  assert.equal(lastLabelEvent?.event, "labeled", "Cannot establish who opted this PR into auto-merge");
  const actor = lastLabelEvent.actor?.login;
  assert.match(actor || "", /^[A-Za-z0-9_-]+(?:\[bot\])?$/);
  if (actor !== appBotLogin || !pr.head.ref.startsWith(releasePrefix) || pr.user?.login !== appBotLogin) {
    const permission = await api(`${prefix}/collaborators/${encodeURIComponent(actor)}/permission`);
    assert.ok(["admin", "maintain", "write"].includes(permission.permission), "Only a maintainer with write access may opt into auto-merge");
  }
  const repository = await api(prefix);
  assert.equal(repository.allow_auto_merge, true, "A repository administrator must enable Allow auto-merge first");
  // Re-fetch after asynchronous authorization checks. gh also pins the exact
  // head for immediate merges; required reviews/checks remain enforced by GitHub.
  const current = await api(`${prefix}/pulls/${number}`);
  if (!eligiblePullRequest(current) || current.head.sha !== pr.head.sha || !current.labels.some((item) => item.name === label)) return "changed";
  await merge(number, pr.head.sha, true);
  return "enabled";
}

export async function promoteRelease({ api, sha, verifiedRunId, repository = gitRepository(), appBotLogin }) {
  assert.match(sha, shaPattern);
  const develop = await api(`${prefix}/branches/develop`);
  if (develop.commit.sha !== sha) return { skipped: "develop-advanced" };
  await verifyQualityRun({ api, repository: RELEASE_REPOSITORY, branch: "develop", sha, runId: verifiedRunId });
  const baselines = {};
  for (const application of APPLICATIONS) baselines[application] = await deploymentBaseline({ api, repository: RELEASE_REPOSITORY, branch: "develop", application });
  const plan = await createReleasePlan({ ...repository, head: sha, before: sha, baselines });
  assert.deepEqual(plan.deployApps, [], "Development still has an undeployed application; promotion is blocked");
  const main = await api(`${prefix}/branches/main`);
  assert.match(main.commit.sha, shaPattern);
  if (main.commit.commit.tree.sha === develop.commit.commit.tree.sha) return { skipped: "same-tree" };
  const ancestry = await api(`${prefix}/compare/${main.commit.sha}...${sha}`);
  if (["behind", "identical"].includes(ancestry.status)) return { skipped: "already-promoted" };
  // Immutable branch names make retries idempotent without force-pushing or
  // silently changing a reviewed PR. Include main ancestry in the release branch.
  const branch = `${releasePrefix}${sha}-${main.commit.sha}`;
  const branches = await api(`${prefix}/git/matching-refs/heads/${branch}`);
  const existing = branches.find((entry) => entry.ref === `refs/heads/${branch}`);
  if (!existing) await api(`${prefix}/git/refs`, { method: "POST", body: { ref: `refs/heads/${branch}`, sha: main.commit.sha } });
  await api(`${prefix}/merges`, { method: "POST", body: { base: branch, head: sha, commit_message: `Release verified develop ${sha.slice(0, 12)}` } });
  const release = await api(`${prefix}/git/ref/heads/${branch}`);
  assert.match(release.object.sha, shaPattern);
  if (release.object.sha !== sha) {
    const commit = await api(`${prefix}/git/commits/${release.object.sha}`);
    assert.deepEqual(commit.parents?.map((parent) => parent.sha), [main.commit.sha, sha],
      "Release branch was changed outside automation; refusing to adopt extra commits");
  }
  for (const base of [sha, main.commit.sha]) {
    const comparison = await api(`${prefix}/compare/${base}...${release.object.sha}`);
    assert.ok(["ahead", "identical"].includes(comparison.status), "Release branch must include both main and verified develop");
  }
  // Stop if a newer development commit arrived during preparation.
  if ((await api(`${prefix}/branches/develop`)).commit.sha !== sha) return { skipped: "develop-advanced" };
  const open = await list(api, `${prefix}/pulls?state=open&base=main`);
  let pr = open.find((item) => item.head.ref === branch && item.head.repo?.full_name === RELEASE_REPOSITORY);
  if (!pr) {
    pr = await api(`${prefix}/pulls`, { method: "POST", body: {
      base: "main", head: branch, title: `Release verified develop ${sha.slice(0, 12)}`,
      body: `Promote develop commit \`${sha}\` after required quality checks and all affected development deployments succeeded. Production deployment remains subject to the production environment approval.\n\nValidation: https://github.com/${RELEASE_REPOSITORY}/actions/runs/${verifiedRunId}\n\nApplication selection is recomputed against each production application's own successful deployment; unchanged applications are skipped.`,
    } });
  }
  assert.equal(pr.user?.login, appBotLogin, "Refusing to adopt a release PR created by another actor");
  // Superseded bot PRs cannot race a newer release through native auto-merge.
  for (const old of open) {
    if (old.number === pr.number || old.user?.login !== appBotLogin || old.head.repo?.full_name !== RELEASE_REPOSITORY || !old.head.ref.startsWith(releasePrefix)) continue;
    await api(`${prefix}/pulls/${old.number}`, { method: "PATCH", body: { state: "closed" } });
  }
  await api(`${prefix}/issues/${pr.number}/labels`, { method: "POST", body: { labels: [label] } });
  return { number: pr.number, branch, sha: release.object.sha };
}

async function main() {
  assert.equal(process.env.GITHUB_REPOSITORY, RELEASE_REPOSITORY);
  assert.equal(process.env.PR_AUTOMATION_ENABLED, "1");
  const api = githubApi(process.env.GH_TOKEN);
  const appBotLogin = process.env.RELEASE_APP_BOT_LOGIN;
  assert.match(appBotLogin || "", /^[A-Za-z0-9_-]+\[bot\]$/);
  assert.equal((await api(prefix)).allow_auto_merge, true, "A repository administrator must enable Allow auto-merge first");
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  const merge = (number, sha, enable) => {
    execFileSync("gh", ["pr", "merge", String(number), "--repo", RELEASE_REPOSITORY,
      ...(enable ? ["--auto", "--merge", "--match-head-commit", sha] : ["--disable-auto"])], { stdio: "inherit" });
  };
  if (event.workflow_run?.name === "PR automation request" || event.inputs?.mode === "automerge") {
    const numbers = await requestedPullNumbers(api, event);
    for (const number of numbers) process.stdout.write(`${await configureAutoMerge({ api, number, merge, appBotLogin })}\n`);
  } else {
    assert.equal(process.env.RELEASE_PROMOTION_ENABLED, "1");
    const run = event.workflow_run;
    if (run && run.head_branch !== "develop") return;
    const sha = run?.head_sha ?? event.inputs?.expected_sha;
    const verifiedRunId = run ? await promotionQualityRun(api, run) : event.inputs?.verified_run_id;
    const promoted = await promoteRelease({ api, sha, verifiedRunId, appBotLogin });
    process.stdout.write(`${JSON.stringify(promoted)}\n`);
    if (promoted.number) process.stdout.write(`${await configureAutoMerge({ api, number: promoted.number, merge, appBotLogin })}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
