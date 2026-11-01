import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execute = promisify(execFile);
const preparation = /^(Set up job|Initialize containers|Checkout|Run actions\/(checkout|setup-)|Use Node|Install |Run npm ci|Run npx playwright install|Download |Post |Stop containers|Complete job|Configure SSH|Remove .*runner|Remove SSH)/;

export function measureJob(run, job) {
  const seconds = (start, end) => start && end ? (Date.parse(end) - Date.parse(start)) / 1000 : null;
  const duration = seconds(job.started_at, job.completed_at);
  const queue = seconds(job.created_at, job.started_at);
  const dependencyWait = seconds(run.createdAt, job.created_at);
  const steps = (job.steps ?? []).filter(step => step.started_at && step.completed_at)
    .map(step => ({ name: step.name, conclusion: step.conclusion,
      phase: preparation.test(step.name) ? "preparation" : "execution",
      seconds: seconds(step.started_at, step.completed_at) }));
  const invalid = [duration, queue, dependencyWait, ...steps.map(step => step.seconds)]
    .some(value => value !== null && (!Number.isFinite(value) || value < 0));
  const execution = steps.filter(step => step.phase === "execution").reduce((total, step) => total + step.seconds, 0);
  const usable = !invalid && duration !== null && execution <= duration;
  return { runId: run.databaseId, workflow: run.workflowName, branch: run.headBranch,
    event: run.event, jobId: job.id, job: job.name, conclusion: job.conclusion,
    dependencySeconds: dependencyWait, queueSeconds: queue,
    preparationSeconds: usable ? duration - execution : null,
    executionSeconds: usable ? execution : null, durationSeconds: duration,
    timingValid: usable, steps };
}

export function summarizeJobs(jobs) {
  const groups = new Map();
  for (const job of jobs.filter(job => job.timingValid && job.conclusion === "success")) {
    const key = `${job.workflow} / ${job.job}`;
    const group = groups.get(key) ?? [];
    group.push(job);
    groups.set(key, group);
  }
  return [...groups].map(([name, group]) => {
    const mean = field => Math.round(group.reduce((total, job) => total + job[field], 0) / group.length * 10) / 10;
    const sorted = group.map(job => job.durationSeconds).sort((left, right) => left - right);
    return { name, count: group.length, queue: mean("queueSeconds"), preparation: mean("preparationSeconds"),
      execution: mean("executionSeconds"), duration: mean("durationSeconds"), p95: sorted[Math.ceil(sorted.length * 0.95) - 1] };
  }).sort((left, right) => right.duration - left.duration);
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const directory = option("--output", ".tmp/actions-timings");
  const gh = async (...parameters) => {
    for (let attempt = 0; ; attempt += 1) {
      try { return JSON.parse((await execute("gh", parameters, { maxBuffer: 32 * 1024 * 1024, windowsHide: true })).stdout); }
      catch (error) { if (attempt >= 2 || !/EOF|502|503|504|timeout|connection/i.test(String(error))) throw error; }
    }
  };
  let records;
  if (args.includes("--input")) {
    records = JSON.parse((await readFile(option("--input"), "utf8")).replace(/^\uFEFF/, ""));
  } else {
    const repository = option("--repo", (await gh("repo", "view", "--json", "nameWithOwner")).nameWithOwner);
    const runs = await gh("run", "list", "--repo", repository, "--limit", option("--limit", "50"), "--json",
      "databaseId,workflowName,event,headBranch,headSha,status,conclusion,createdAt,startedAt,updatedAt,url");
    records = [];
    for (let offset = 0; offset < runs.length; offset += 5) {
      records.push(...await Promise.all(runs.slice(offset, offset + 5).map(async run => {
        const jobs = [];
        for (let page = 1; ; page += 1) {
          const response = await gh("api", `repos/${repository}/actions/runs/${run.databaseId}/jobs?per_page=100&page=${page}`);
          jobs.push(...response.jobs);
          if (jobs.length >= response.total_count) break;
        }
        return { run, jobs };
      })));
    }
  }
  const jobs = records.flatMap(({ run, jobs: entries }) => entries.map(job => measureJob(run, job)));
  const summary = summarizeJobs(jobs);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "runs.json"), JSON.stringify(records, null, 2));
  await writeFile(path.join(directory, "jobs.json"), JSON.stringify(jobs, null, 2));
  await writeFile(path.join(directory, "summary.json"), JSON.stringify(summary, null, 2));
  const fields = ["runId", "workflow", "branch", "jobId", "job", "conclusion", "dependencySeconds", "queueSeconds", "preparationSeconds", "executionSeconds", "durationSeconds", "timingValid"];
  const cell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  await writeFile(path.join(directory, "jobs.csv"), [fields, ...jobs.map(job => fields.map(field => job[field]))].map(row => row.map(cell).join(",")).join("\n") + "\n");
  const report = ["# Actions timing report", "",
    `Runs: ${records.length}. Jobs: ${jobs.length}. Invalid timestamp records: ${jobs.filter(job => !job.timingValid).length}.`, "",
    "Queue = job created to runner start. Dependency wait = workflow created to job created, reported separately to avoid counting dependency work as runner queue time.",
    "Preparation includes runner/container setup, checkout, dependency installation, downloads, cleanup and inter-step overhead. Execution includes named tests, builds and workflow operations. Mixed steps cannot be separated further from the Jobs API. Invalid timestamps are retained but excluded from averages.", "",
    "| Job | Samples | Queue (s) | Preparation (s) | Execution (s) | Total (s) | P95 (s) |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...summary.map(row => `| ${row.name} | ${row.count} | ${row.queue} | ${row.preparation} | ${row.execution} | ${row.duration} | ${row.p95} |`), ""];
  await writeFile(path.join(directory, "report.md"), report.join("\n"));
  process.stdout.write(`Saved ${records.length} runs and ${jobs.length} jobs to ${directory}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
