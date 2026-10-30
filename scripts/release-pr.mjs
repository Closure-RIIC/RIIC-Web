import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import console from "node:console";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { APPLICATIONS, createReleasePlan, gitRepository } from "./app-release-plan.mjs";
import { assertCurrentRelease, deploymentBaseline, RELEASE_REPOSITORY, verifyQualityRun } from "./release-provenance.mjs";

const prefix = `/repos/${RELEASE_REPOSITORY}`;
const workflow = "frontend-quality.yml";
const shaPattern = /^[a-f0-9]{40}$/;
const help = `Usage:
  npm run release:pr -- <PR number or URL>
  npm run release:pr -- <PR> --execute --head <reviewed SHA> [--approve-production]

The default command only previews. Execution merges into develop, waits for its
verified deployment, merges the exact automatic release PR into main, and waits
for production. GitHub still enforces checks, reviews and environment permissions.
Repeat the same command after interruption. Failed CI is never retried silently.
--include-develop explicitly includes other changes already waiting on develop.
--timeout-minutes <1..240> bounds each invocation (default 90).
`;

export function parseOptions(args) {
  const options = { execute: false, approveProduction: false, includeDevelop: false, timeoutMinutes: 90 };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--execute") options.execute = true;
    else if (arg === "--approve-production") options.approveProduction = true;
    else if (arg === "--include-develop") options.includeDevelop = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--head") options.head = args[++i];
    else if (arg === "--timeout-minutes") options.timeoutMinutes = Number(args[++i]);
    else {
      assert.equal(options.number, undefined, `Unexpected argument: ${arg}`);
      const number = arg.match(/^[1-9][0-9]*$/)?.[0] ?? arg.match(/^https:\/\/github\.com\/Closure-RIIC\/RIIC-Web\/pull\/([1-9][0-9]*)\/?$/)?.[1];
      assert.ok(number, "Provide one RIIC-Web PR number or URL");
      options.number = Number(number);
      assert.ok(Number.isSafeInteger(options.number));
    }
  }
  if (options.help) return options;
  assert.ok(options.number, "PR number is required; use --help");
  assert.ok(Number.isInteger(options.timeoutMinutes) && options.timeoutMinutes >= 1 && options.timeoutMinutes <= 240);
  if (options.execute) assert.match(options.head || "", shaPattern, "Execution requires --head from the preview");
  assert.ok(!options.approveProduction || options.execute, "--approve-production requires --execute");
  return options;
}

// gh supplies its existing authenticated connection; tokens are never read or saved.
export async function ghApi(path, { method = "GET", body } = {}, { execute = execFileSync, sleep = delay } = {}) {
  assert.ok(path === prefix || path.startsWith(`${prefix}/`), "Unexpected repository API path");
  const args = ["api", path, "--method", method];
  if (body !== undefined) args.push("--input", "-");
  for (let attempt = 0; ; attempt++) {
    try {
      const output = execute("gh", args, { input: body === undefined ? undefined : JSON.stringify(body),
        encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 60_000, stdio: ["pipe", "pipe", "pipe"] });
      return output.trim() ? JSON.parse(output) : null;
    } catch (error) {
      const detail = String(error.stderr || "").trim();
      const transient = error.code === "ETIMEDOUT" || /TLS handshake timeout|i\/o timeout|connection reset|unexpected EOF|HTTP 50[234]/i.test(detail);
      // A write may already have succeeded. Only reads are safe to retry here.
      if (method === "GET" && transient && attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
      throw new Error(`${method} ${path} failed. Repeat the release command after resolving this GitHub API error.\n${detail}`, { cause: error });
    }
  }
}

export function validatePull(pr, base, head) {
  assert.equal(pr.base?.repo?.full_name, RELEASE_REPOSITORY);
  assert.equal(pr.base.ref, base, `PR must target ${base}`);
  assert.equal(pr.draft, false, "Draft PRs cannot be released");
  assert.match(pr.head?.sha || "", shaPattern);
  if (head) assert.equal(pr.head.sha, head, "PR changed; preview and review its new head before continuing");
  assert.ok(pr.state === "open" || pr.merged, "PR was closed without merging");
  if (base === "main") {
    assert.equal(pr.head.repo?.full_name, RELEASE_REPOSITORY);
    assert.ok(pr.head.ref.startsWith("release/"));
    assert.ok(!pr.labels.some(label => label.name === "direct-main-release"), "Selective releases require a separate workflow");
  }
}

export function requiredChecksState(requirements, checks, statuses) {
  const required = requirements.checks?.length ? requirements.checks : requirements.contexts.map(context => ({ context }));
  assert.ok(required.length, "No required CI checks found; refusing an unverified merge");
  const waiting = [];
  for (const { context, app_id: appId } of required) {
    const check = checks.filter(item => item.name === context && (!appId || item.app?.id === appId)).sort((a, b) => b.id - a.id)[0];
    if (check) {
      if (check.status !== "completed") waiting.push(context);
      else assert.ok(["success", "neutral", "skipped"].includes(check.conclusion), `Required check failed: ${context} ${check.html_url || ""}`);
    } else {
      // Status API records have no verifiable App ID. Let them satisfy only
      // an unpinned requirement; GitHub remains the final merge authority.
      const status = !appId && statuses.filter(item => item.context === context).sort((a, b) => b.id - a.id)[0];
      if (!status || status.state === "pending") waiting.push(context);
      else assert.equal(status.state, "success", `Required status failed: ${context}`);
    }
  }
  return waiting;
}

export class ReleaseCommand {
  constructor({ api = ghApi, sleep = delay, now = Date.now, log = console.log, verifyApps } = {}) {
    Object.assign(this, { api, sleep, now, log });
    this.verifyApps = verifyApps ?? (async (branch, sha) => {
      const baselines = {};
      for (const application of APPLICATIONS) baselines[application] = await deploymentBaseline({ api: this.api, repository: RELEASE_REPOSITORY, branch, application });
      const refs = [...new Set([sha, ...Object.values(baselines).filter(Boolean)])];
      execFileSync("git", ["fetch", "--no-tags", "origin", ...refs], { timeout: 120_000, stdio: ["ignore", "ignore", "pipe"] });
      const plan = await createReleasePlan({ ...gitRepository(), head: sha, before: sha, baselines });
      assert.deepEqual(plan.deployApps, [], `${branch} still has undeployed application changes`);
      return baselines;
    });
  }
  async pause(message) {
    this.log(message);
    assert.ok(this.now() < this.deadline, "Timed out. Repeat the same command to resume from GitHub state");
    await this.sleep(30_000);
  }
  async list(path, key) {
    const items = [];
    for (let page = 1; page <= 20; page++) {
      const response = await this.api(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      const rows = key ? response[key] : response;
      assert.ok(Array.isArray(rows));
      items.push(...rows);
      if (rows.length < 100) return items;
    }
    throw new Error("Release metadata exceeds pagination limit");
  }
  async current(branch, sha) {
    await assertCurrentRelease({ api: this.api, repository: RELEASE_REPOSITORY, branch, sha });
  }
  async mergePull(number, base, head, baseSha) {
    while (true) {
      const pr = await this.api(`${prefix}/pulls/${number}`);
      validatePull(pr, base, head);
      if (pr.merged) { assert.match(pr.merge_commit_sha, shaPattern); return pr.merge_commit_sha; }
      await this.current(base, baseSha);
      assert.notEqual(pr.mergeable, false, `PR #${number} has conflicts; resolve them before retrying`);
      assert.notEqual(pr.mergeable_state, "behind", `PR #${number} is behind ${base}; update its branch, then preview the new head`);
      const requirements = await this.api(`${prefix}/branches/${base}/protection/required_status_checks`);
      const checks = await this.list(`${prefix}/commits/${head}/check-runs`, "check_runs");
      const statuses = await this.list(`${prefix}/commits/${head}/statuses`);
      const waiting = requiredChecksState(requirements, checks, statuses);
      if (waiting.length || pr.mergeable === null) {
        await this.pause(`PR #${number}: waiting for ${waiting.join(", ") || "mergeability"}`);
        continue;
      }
      await this.current(base, baseSha);
      // Normal merge endpoint, with a head lease. No admin override or protection changes.
      const result = await this.api(`${prefix}/pulls/${number}/merge`, { method: "PUT", body: { sha: head, merge_method: "merge" } });
      assert.equal(result.merged, true, result.message);
      assert.match(result.sha, shaPattern);
      return result.sha;
    }
  }
  async approve(run, options) {
    const pending = await this.api(`${prefix}/actions/runs/${run.id}/pending_deployments`);
    if (!pending.length) return;
    assert.equal(run.head_branch, "main", "Unexpected development approval requirement; review in GitHub");
    assert.ok(options.approveProduction, `Production awaits approval: ${run.html_url}. Approve in GitHub or repeat with --approve-production`);
    for (const item of pending) {
      assert.equal(item.environment.name, "production");
      assert.equal(item.current_user_can_approve, true, `Current GitHub user cannot approve ${run.html_url}`);
      assert.ok(Number.isSafeInteger(item.environment.id) && item.environment.id > 0);
    }
    const jobs = await this.list(`${prefix}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, "jobs");
    assert.equal(jobs.filter(job => job.name === "quality" && job.conclusion === "success").length, 1, "Quality gate must pass before approval");
    await this.current("main", run.head_sha);
    await this.api(`${prefix}/actions/runs/${run.id}/pending_deployments`, { method: "POST", body: {
      environment_ids: [...new Set(pending.map(item => item.environment.id))], state: "approved",
      comment: `Explicit release:pr --approve-production authorization for ${run.head_sha}`,
    } });
  }
  async waitRelease(branch, sha, options) {
    const started = this.now();
    let dispatched = false;
    while (true) {
      await this.current(branch, sha);
      const runs = await this.list(`${prefix}/actions/workflows/${workflow}/runs?branch=${branch}&head_sha=${sha}`, "workflow_runs");
      const run = runs.filter(item => ["push", "workflow_dispatch"].includes(item.event)).sort((a, b) => b.id - a.id)[0];
      if (!run) {
        if (!dispatched && this.now() - started >= 60_000) {
          await this.current(branch, sha);
          await this.api(`${prefix}/actions/workflows/${workflow}/dispatches`, { method: "POST", body: {
            ref: branch, inputs: { deploy: "true", expected_sha: sha, run_webkit: "false" },
          } });
          dispatched = true;
        }
        await this.pause(`${branch}: waiting for release workflow (${sha.slice(0, 12)})`);
        continue;
      }
      assert.equal(run.head_sha, sha);
      assert.equal(run.head_branch, branch);
      assert.equal(run.repository?.full_name, RELEASE_REPOSITORY);
      assert.equal(run.head_repository?.full_name, RELEASE_REPOSITORY);
      assert.equal(run.path, `.github/workflows/${workflow}`);
      if (run.status === "completed") {
        assert.equal(run.conclusion, "success", `Release failed: ${run.html_url}. Diagnose, then retry the failed jobs explicitly`);
        const jobs = await this.list(`${prefix}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, "jobs");
        assert.equal(jobs.filter(job => job.name === "quality" && job.conclusion === "success").length, 1);
        if (jobs.some(job => job.name === "Build release once" && job.conclusion !== "skipped")) {
          await verifyQualityRun({ api: this.api, repository: RELEASE_REPOSITORY, branch, sha, runId: run.id });
        }
        const applications = await this.verifyApps(branch, sha);
        await this.current(branch, sha);
        return { sha, runId: run.id, url: run.html_url, applications };
      }
      await this.approve(run, options);
      await this.pause(`${branch}: ${run.status} ${run.html_url}`);
    }
  }
  async releasePull(developSha, verifiedRunId) {
    const started = this.now();
    let dispatched = false;
    const develop = await this.api(`${prefix}/branches/develop`);
    while (true) {
      await this.current("develop", developSha);
      const main = await this.api(`${prefix}/branches/main`);
      if (main.commit.commit.tree.sha === develop.commit.commit.tree.sha) return { alreadyMerged: main.commit.sha };
      const pulls = await this.list(`${prefix}/pulls?state=open&base=main`);
      const matches = pulls.filter(pr => pr.head.repo?.full_name === RELEASE_REPOSITORY &&
        pr.head.ref === `release/automation/develop-${developSha}-${main.commit.sha}`);
      assert.ok(matches.length <= 1, "Ambiguous release PRs");
      if (matches.length) {
        const pr = matches[0];
        validatePull(pr, "main");
        const commit = await this.api(`${prefix}/git/commits/${pr.head.sha}`);
        assert.equal(commit.tree.sha, develop.commit.commit.tree.sha, "Release PR contains unexpected changes");
        for (const base of [developSha, main.commit.sha]) {
          const comparison = await this.api(`${prefix}/compare/${base}...${pr.head.sha}`);
          assert.ok(["ahead", "identical"].includes(comparison.status), "Release PR must contain main and verified develop");
        }
        return { pr, baseSha: main.commit.sha };
      }
      if (!dispatched && this.now() - started >= 90_000) {
        await this.api(`${prefix}/actions/workflows/release-automation.yml/dispatches`, { method: "POST", body: {
          ref: "main", inputs: { mode: "promote", verified_run_id: String(verifiedRunId), expected_sha: developSha },
        } });
        dispatched = true;
      }
      await this.pause("Waiting for the verified develop-to-main release PR");
    }
  }
  async run(options) {
    this.deadline = this.now() + options.timeoutMinutes * 60_000;
    const pr = await this.api(`${prefix}/pulls/${options.number}`);
    validatePull(pr, "develop", options.head);
    const develop = await this.api(`${prefix}/branches/develop`);
    const main = await this.api(`${prefix}/branches/main`);
    const pendingDevelop = develop.commit.commit.tree.sha !== main.commit.commit.tree.sha;
    const plan = { pr: pr.number, title: pr.title, head: pr.head.sha, merged: pr.merged,
      develop: develop.commit.sha, main: main.commit.sha, pendingDevelop,
      command: `npm run release:pr -- ${pr.number} --execute --head ${pr.head.sha} --approve-production` };
    this.log(JSON.stringify(plan, null, 2));
    if (!options.execute) return plan;
    assert.ok(pr.merged || !pendingDevelop || options.includeDevelop, "develop contains other unpublished changes; review them and use --include-develop explicitly");
    for (const name of ["DEPLOY_AUTOMATION_ENABLED", "PR_AUTOMATION_ENABLED", "RELEASE_PROMOTION_ENABLED"]) {
      const variable = await this.api(`${prefix}/actions/variables/${name}`);
      assert.equal(variable.value, "1", `${name} must be configured by a repository administrator`);
    }
    const developSha = await this.mergePull(pr.number, "develop", pr.head.sha, develop.commit.sha);
    const development = await this.waitRelease("develop", developSha, options);
    const release = await this.releasePull(developSha, development.runId);
    const mainSha = release.alreadyMerged ?? await this.mergePull(release.pr.number, "main", release.pr.head.sha, release.baseSha);
    const production = await this.waitRelease("main", mainSha, options);
    await this.current("develop", developSha);
    const result = { development, production };
    this.log(JSON.stringify(result, null, 2));
    return result;
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) { process.stdout.write(help); return; }
  const origin = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  assert.match(origin, /^(?:https:\/\/github\.com\/|git@github\.com:)Closure-RIIC\/RIIC-Web(?:\.git)?$/, "Run from the RIIC-Web repository");
  await new ReleaseCommand().run(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
