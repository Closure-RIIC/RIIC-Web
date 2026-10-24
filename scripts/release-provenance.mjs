import assert from "node:assert/strict";
import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import process from "node:process";

export const RELEASE_REPOSITORY = "KnightCodeSquareMatrix/RIIC-Web";
const SHA = /^[a-f0-9]{40}$/;
const requiredJobs = ["Change scope", "Repository hygiene", "Static and unit checks", "Database integration", "Build release once", "quality"];

function validateTarget(repository, branch, sha) {
  assert.equal(repository, RELEASE_REPOSITORY, "Unexpected release repository");
  assert.ok(["main", "develop"].includes(branch), "Only main/develop can deploy");
  if (sha !== undefined) assert.match(sha, SHA, "Invalid release SHA");
}

export function githubApi(token, fetchImpl = globalThis.fetch) {
  assert.ok(token, "GitHub token is required");
  return async (path, { method = "GET", body } = {}) => {
    assert.ok(path === `/repos/${RELEASE_REPOSITORY}` || path.startsWith(`/repos/${RELEASE_REPOSITORY}/`), "Unexpected API path");
    const response = await fetchImpl(`https://api.github.com${path}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
      signal: globalThis.AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Release metadata request failed (${response.status})`);
    if (response.status === 204) return null;
    return response.json();
  };
}

// Unknown/missing deployment history must select full validation, never the last push.
export async function deploymentBaseline({ api, repository, branch, application }) {
  validateTarget(repository, branch);
  assert.ok(["arknights", "endfield"].includes(application), "Application is required for deployment history");
  const environment = branch === "main" ? "production" : "development";
  for (let page = 1; page <= 20; page += 1) {
    const deployments = await api(`/repos/${repository}/deployments?environment=${environment}&task=deploy:${application}&per_page=100&page=${page}`);
    for (const deployment of deployments) {
      if (deployment.environment !== environment || deployment.task !== `deploy:${application}` || !SHA.test(deployment.sha)) continue;
      const payload = typeof deployment.payload === "string" ? JSON.parse(deployment.payload) : deployment.payload;
      if (payload?.formatVersion !== 1 || payload.application !== application || payload.branch !== branch) continue;
      assert.ok(Number.isSafeInteger(deployment.id) && deployment.id > 0);
      const statuses = await api(`/repos/${repository}/deployments/${deployment.id}/statuses?per_page=100`);
      // GitHub's environment job may mark previous deployments inactive. That
      // changes visibility, not whether this application's release passed health.
      const latest = statuses.find((status) => status.state !== "inactive");
      if (latest?.state === "success") return deployment.sha;
    }
    if (deployments.length < 100) return "";
  }
  return "";
}

async function collect(api, path, key) {
  const items = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await api(`${path}?per_page=100&page=${page}`);
    assert.ok(Array.isArray(response[key]), `Missing ${key}`);
    items.push(...response[key]);
    if (items.length >= response.total_count) return items;
  }
  throw new Error("Release metadata pagination exceeded its limit");
}

export async function verifyQualityRun({ api, repository, branch, sha, runId }) {
  validateTarget(repository, branch, sha);
  assert.match(String(runId), /^[1-9][0-9]*$/, "Invalid workflow run ID");
  const prefix = `/repos/${repository}/actions/runs/${runId}`;
  const run = await api(prefix);
  assert.equal(String(run.id), String(runId));
  assert.equal(run.repository?.full_name, repository);
  assert.equal(run.head_repository?.full_name, repository, "Fork artifacts cannot deploy");
  assert.equal(run.path, ".github/workflows/frontend-quality.yml", "Untrusted source workflow");
  assert.ok(["push", "workflow_dispatch"].includes(run.event), "Untrusted source event");
  assert.equal(run.head_branch, branch, "Cross-environment artifact reuse is forbidden");
  assert.equal(run.head_sha, sha, "Source run must verify the exact current commit");
  assert.equal(run.status, "completed");
  // A sibling deployment may have failed after quality succeeded. Reuse only
  // the selected app's verified artifact, never waive a required quality check.
  assert.ok(["success", "failure"].includes(run.conclusion), "Source workflow must complete its verification");
  assert.ok(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0);
  const jobs = await collect(api, `${prefix}/attempts/${run.run_attempt}/jobs`, "jobs");
  for (const name of requiredJobs) {
    const matches = jobs.filter((job) => job.name === name);
    assert.equal(matches.length, 1, `Missing or ambiguous required job: ${name}`);
    assert.equal(matches[0].conclusion, "success", `Required job did not pass: ${name}`);
  }
  return run;
}

export async function verifyReleaseRun({ api, repository, branch, sha, runId, application = "arknights" }) {
  assert.ok(["arknights", "endfield"].includes(application));
  const run = await verifyQualityRun({ api, repository, branch, sha, runId });
  const prefix = `/repos/${repository}/actions/runs/${runId}`;
  const artifactName = `${application === "arknights" ? "riic-web" : "endfield"}-release-${sha}`;
  const artifacts = await collect(api, `${prefix}/artifacts`, "artifacts");
  const matches = artifacts.filter((artifact) => artifact.name === artifactName);
  assert.equal(matches.length, 1, "Missing or ambiguous release artifact; run full validation");
  const artifact = matches[0];
  assert.equal(artifact.expired, false, "Release artifact expired; run full validation");
  assert.ok(artifact.size_in_bytes > 0);
  assert.equal(String(artifact.workflow_run?.id), String(runId));
  assert.equal(artifact.workflow_run?.head_sha, sha);
  assert.equal(artifact.workflow_run?.head_branch, branch);
  assert.equal(artifact.workflow_run?.head_repository_id, run.repository.id);
  assert.equal(artifact.workflow_run?.repository_id, run.repository.id);
  return { artifactName, runId: String(runId) };
}

export async function assertCurrentRelease({ api, repository, branch, sha }) {
  validateTarget(repository, branch, sha);
  const current = await api(`/repos/${repository}/git/ref/heads/${branch}`);
  assert.equal(current.object?.sha, sha, "Branch advanced; refusing to deploy an older release");
}

export async function prepareDeployment(options) {
  const { api, repository, branch, sha, application, runId, attempt } = options;
  await assertCurrentRelease(options);
  if (await deploymentBaseline(options) === sha) return { required: false, deploymentId: "" };
  assert.match(String(runId), /^[1-9][0-9]*$/);
  assert.match(String(attempt), /^[1-9][0-9]*$/);
  const deployment = await api(`/repos/${repository}/deployments`, {
    method: "POST",
    body: {
      ref: sha, task: `deploy:${application}`, auto_merge: false, required_contexts: [],
      environment: branch === "main" ? "production" : "development",
      production_environment: branch === "main", transient_environment: false,
      payload: { formatVersion: 1, application, branch, runId: String(runId), attempt: String(attempt) },
      description: `Verified ${application} release`,
    },
  });
  assert.ok(Number.isSafeInteger(deployment.id) && deployment.id > 0);
  return { required: true, deploymentId: String(deployment.id) };
}

export async function finishDeployment({ api, repository, branch, sha, application, deploymentId, result, runId, attempt }) {
  validateTarget(repository, branch, sha);
  assert.ok(["arknights", "endfield"].includes(application));
  assert.match(String(deploymentId), /^[1-9][0-9]*$/);
  assert.ok(["success", "failure", "cancelled"].includes(result));
  assert.match(String(runId), /^[1-9][0-9]*$/);
  const deployment = await api(`/repos/${repository}/deployments/${deploymentId}`);
  assert.equal(deployment.sha, sha);
  assert.equal(deployment.task, `deploy:${application}`);
  assert.equal(deployment.environment, branch === "main" ? "production" : "development");
  const payload = typeof deployment.payload === "string" ? JSON.parse(deployment.payload) : deployment.payload;
  assert.deepEqual(payload, { formatVersion: 1, application, branch, runId: String(runId), attempt: String(attempt) });
  await api(`/repos/${repository}/deployments/${deploymentId}/statuses`, {
    method: "POST", body: {
      state: result === "success" ? "success" : "failure", auto_inactive: false,
      description: result === "success" ? "Release installed and health verification passed" : "Release failed or was cancelled; baseline retained",
      log_url: `https://github.com/${repository}/actions/runs/${runId}`,
    },
  });
}

async function main() {
  const { GITHUB_REPOSITORY: repository, GITHUB_REF_NAME: branch, GITHUB_SHA: sha, GITHUB_OUTPUT: output } = process.env;
  const api = githubApi(process.env.GH_TOKEN);
  const command = process.argv[2];
  const options = { api, repository, branch, sha, application: process.env.DEPLOY_APPLICATION, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT };
  if (command === "baseline") {
    let baseline = "";
    try { baseline = await deploymentBaseline(options); }
    catch { process.stderr.write("Deployment history unavailable; full validation and deployment will be selected.\n"); }
    await appendFile(output, `base_sha=${baseline}\n`);
  } else if (command === "verify") {
    assert.equal(process.env.EXPECTED_SHA, sha, "Requested commit no longer matches the selected branch");
    await assertCurrentRelease(options);
    const verified = await verifyReleaseRun({ ...options, runId: process.env.VERIFIED_RUN_ID });
    await appendFile(output, `artifact_name=${verified.artifactName}\nartifact_run_id=${verified.runId}\n`);
  } else if (command === "prepare") {
    const prepared = await prepareDeployment(options);
    await appendFile(output, `required=${prepared.required}\ndeployment_id=${prepared.deploymentId}\n`);
  } else if (command === "assert-current") {
    await assertCurrentRelease(options);
  } else if (command === "finish") {
    await finishDeployment({ ...options, deploymentId: process.env.DEPLOYMENT_ID, result: process.env.DEPLOY_RESULT });
  } else {
    throw new Error("Usage: node scripts/release-provenance.mjs baseline|verify|prepare|assert-current|finish");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
