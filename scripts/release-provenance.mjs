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
  return async (path) => {
    assert.ok(path.startsWith(`/repos/${RELEASE_REPOSITORY}/`), "Unexpected API path");
    const response = await fetchImpl(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      signal: globalThis.AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Release metadata request failed (${response.status})`);
    return response.json();
  };
}

// Unknown/missing deployment history must select full validation, never the last push.
export async function deploymentBaseline({ api, repository, branch }) {
  validateTarget(repository, branch);
  const environment = branch === "main" ? "production" : "development";
  const deployments = await api(`/repos/${repository}/deployments?environment=${environment}&per_page=20`);
  for (const deployment of deployments) {
    if (deployment.environment !== environment || deployment.ref !== branch || !SHA.test(deployment.sha)) continue;
    assert.ok(Number.isSafeInteger(deployment.id) && deployment.id > 0);
    const statuses = await api(`/repos/${repository}/deployments/${deployment.id}/statuses?per_page=1`);
    if (statuses[0]?.state === "success") return deployment.sha;
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

export async function verifyReleaseRun({ api, repository, branch, sha, runId }) {
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
  assert.equal(run.conclusion, "success", "Source workflow must pass all required checks");
  assert.ok(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0);
  const jobs = await collect(api, `${prefix}/attempts/${run.run_attempt}/jobs`, "jobs");
  for (const name of requiredJobs) {
    const matches = jobs.filter((job) => job.name === name);
    assert.equal(matches.length, 1, `Missing or ambiguous required job: ${name}`);
    assert.equal(matches[0].conclusion, "success", `Required job did not pass: ${name}`);
  }
  const artifactName = `riic-web-release-${sha}`;
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

async function main() {
  const { GITHUB_REPOSITORY: repository, GITHUB_REF_NAME: branch, GITHUB_SHA: sha, GITHUB_OUTPUT: output } = process.env;
  const api = githubApi(process.env.GH_TOKEN);
  const command = process.argv[2];
  if (command === "baseline") {
    let baseline = "";
    try { baseline = await deploymentBaseline({ api, repository, branch }); }
    catch { process.stderr.write("Deployment history unavailable; full validation and deployment will be selected.\n"); }
    await appendFile(output, `base_sha=${baseline}\n`);
  } else if (command === "verify") {
    assert.equal(process.env.EXPECTED_SHA, sha, "Requested commit no longer matches the selected branch");
    const verified = await verifyReleaseRun({ api, repository, branch, sha, runId: process.env.VERIFIED_RUN_ID });
    await appendFile(output, `artifact_name=${verified.artifactName}\nartifact_run_id=${verified.runId}\n`);
  } else {
    throw new Error("Usage: node scripts/release-provenance.mjs baseline|verify");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
