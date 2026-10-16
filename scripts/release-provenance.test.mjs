import test from "node:test";
import assert from "node:assert/strict";
import { deploymentBaseline, githubApi, RELEASE_REPOSITORY, verifyReleaseRun } from "./release-provenance.mjs";

const sha = "a".repeat(40);
const otherSha = "b".repeat(40);
const repository = RELEASE_REPOSITORY;
const prefix = `/repos/${repository}/actions/runs/123`;
function fixture() {
  const run = {
    id: 123, repository: { id: 42, full_name: repository }, head_repository: { full_name: repository },
    path: ".github/workflows/frontend-quality.yml", event: "push", head_branch: "develop",
    head_sha: sha, status: "completed", conclusion: "success", run_attempt: 2,
  };
  const jobs = ["Change scope", "Repository hygiene", "Static and unit checks", "Database integration", "Build release once", "quality"]
    .map((name) => ({ name, conclusion: "success" }));
  const artifact = {
    name: `riic-web-release-${sha}`, expired: false, size_in_bytes: 100,
    workflow_run: { id: 123, head_sha: sha, head_branch: "develop", repository_id: 42, head_repository_id: 42 },
  };
  const artifacts = [artifact];
  const api = async (path) => {
    if (path === prefix) return run;
    if (path === `${prefix}/attempts/2/jobs?per_page=100&page=1`) return { total_count: jobs.length, jobs };
    if (path === `${prefix}/artifacts?per_page=100&page=1`) return { total_count: artifacts.length, artifacts };
    throw new Error(`Unexpected fixture path: ${path}`);
  };
  return { run, jobs, artifact, artifacts, api, options: { api, repository, branch: "develop", sha, runId: "123" } };
}

test("only a successful exact-commit run from the same branch can supply a release", async () => {
  const f = fixture();
  assert.deepEqual(await verifyReleaseRun(f.options), { artifactName: `riic-web-release-${sha}`, runId: "123" });
  f.run.event = "workflow_dispatch";
  assert.equal((await verifyReleaseRun(f.options)).runId, "123");
});

test("rejects stale, foreign, incomplete and untrusted verification", async (t) => {
  const mutations = {
    "different repository": (f) => { f.run.repository.full_name = "other/repository"; },
    "fork head": (f) => { f.run.head_repository.full_name = "other/fork"; },
    "different workflow": (f) => { f.run.path = ".github/workflows/untrusted.yml"; },
    "pull request event": (f) => { f.run.event = "pull_request"; },
    "scheduled verification": (f) => { f.run.event = "schedule"; },
    "wrong branch/profile": (f) => { f.run.head_branch = "main"; },
    "old commit": (f) => { f.run.head_sha = otherSha; },
    "unfinished run": (f) => { f.run.status = "in_progress"; },
    "failed run": (f) => { f.run.conclusion = "failure"; },
    "invalid attempt": (f) => { f.run.run_attempt = 0; },
    "quality missing": (f) => { f.jobs.pop(); },
    "quality failed": (f) => { f.jobs.at(-1).conclusion = "failure"; },
    "build skipped": (f) => { f.jobs.find((j) => j.name === "Build release once").conclusion = "skipped"; },
    "ambiguous quality": (f) => { f.jobs.push({ name: "quality", conclusion: "success" }); },
    "artifact missing": (f) => { f.artifacts.pop(); },
    "duplicate artifact": (f) => { f.artifacts.push({ ...f.artifact }); },
    "expired artifact": (f) => { f.artifact.expired = true; },
    "empty artifact": (f) => { f.artifact.size_in_bytes = 0; },
    "artifact from other run": (f) => { f.artifact.workflow_run.id = 456; },
    "artifact from other commit": (f) => { f.artifact.workflow_run.head_sha = otherSha; },
    "artifact from other profile": (f) => { f.artifact.workflow_run.head_branch = "main"; },
    "artifact from fork": (f) => { f.artifact.workflow_run.head_repository_id = 99; },
    "artifact wrong repository": (f) => { f.artifact.workflow_run.repository_id = 99; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    await t.test(name, async () => {
      const f = fixture();
      mutate(f);
      await assert.rejects(verifyReleaseRun(f.options));
    });
  }
});

test("validates inputs before using them as API paths", async () => {
  for (const override of [{ branch: "feature/x" }, { repository: "other/repo" }, { sha: "bad" }, { runId: "123/../../456" }]) {
    await assert.rejects(verifyReleaseRun({ ...fixture().options, ...override }));
  }
});

test("job and artifact pages are fully inspected", async () => {
  const f = fixture();
  const api = async (path) => {
    if (path.endsWith("/jobs?per_page=100&page=1")) return { total_count: 7, jobs: f.jobs };
    if (path.endsWith("/jobs?per_page=100&page=2")) return { total_count: 7, jobs: [{ name: "optional", conclusion: "skipped" }] };
    if (path.endsWith("/artifacts?per_page=100&page=1")) return { total_count: 2, artifacts: [{ name: "unrelated" }] };
    if (path.endsWith("/artifacts?per_page=100&page=2")) return { total_count: 2, artifacts: [f.artifact] };
    return f.api(path);
  };
  assert.equal((await verifyReleaseRun({ ...f.options, api })).runId, "123");
});

test("deployment baseline skips failed releases, retaining unshipped application changes", async () => {
  const queries = [];
  const api = async (path) => {
    queries.push(path);
    if (path.includes("/deployments?")) return [
      { id: 3, environment: "production", ref: "main", sha },
      { id: 2, environment: "development", ref: "develop", sha },
      { id: 1, environment: "development", ref: "develop", sha: otherSha },
    ];
    if (path.endsWith("/2/statuses?per_page=1")) return [{ state: "failure" }];
    if (path.endsWith("/1/statuses?per_page=1")) return [{ state: "success" }];
    throw new Error("Unexpected deployment");
  };
  assert.equal(await deploymentBaseline({ api, repository, branch: "develop" }), otherSha);
  assert.equal(queries.length, 3);
});

test("unknown deployment history has no trusted baseline", async () => {
  assert.equal(await deploymentBaseline({ api: async () => [], repository, branch: "main" }), "");
  await assert.rejects(deploymentBaseline({ api: async () => { throw new Error("unavailable"); }, repository, branch: "develop" }));
});

test("API wrapper confines token use and does not expose error response bodies", async () => {
  let calls = 0;
  const api = githubApi("fixture-token", async (url, options) => {
    calls += 1;
    assert.ok(url.startsWith(`https://api.github.com/repos/${repository}/`));
    assert.equal(options.headers.Authorization, "Bearer fixture-token");
    return { ok: false, status: 403 };
  });
  await assert.rejects(api("https://other.invalid"), /Unexpected API path/);
  assert.equal(calls, 0);
  await assert.rejects(api(`/repos/${repository}/actions/runs/123`), /Release metadata request failed \(403\)/);
});
