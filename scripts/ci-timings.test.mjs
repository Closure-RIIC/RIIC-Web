import assert from "node:assert/strict";
import test from "node:test";
import { measureJob, summarizeJobs } from "./ci-timings.mjs";

const time = seconds => new Date(Date.UTC(2026, 10, 2, 0, 0, seconds)).toISOString();
const run = { databaseId: 1, workflowName: "CI", createdAt: time(0) };
const job = { id: 2, name: "tests", conclusion: "success", created_at: time(20), started_at: time(25), completed_at: time(70),
  steps: [{ name: "Install dependencies", started_at: time(26), completed_at: time(40) },
    { name: "Unit tests", started_at: time(40), completed_at: time(65) }] };

test("queue, dependency wait and preparation overhead are not counted as test time", () => {
  const result = measureJob(run, job);
  assert.equal(result.dependencySeconds, 20);
  assert.equal(result.queueSeconds, 5);
  assert.equal(result.preparationSeconds, 20);
  assert.equal(result.executionSeconds, 25);
  assert.equal(result.durationSeconds, 45);
});

test("historical timestamp anomalies remain visible but never skew averages", () => {
  const invalid = measureJob(run, { ...job, completed_at: time(10) });
  assert.equal(invalid.timingValid, false);
  assert.equal(invalid.executionSeconds, null);
  assert.equal(summarizeJobs([measureJob(run, job), invalid])[0].duration, 45);
  assert.equal(summarizeJobs([measureJob(run, job), invalid])[0].count, 1);
});

test("cancelled, skipped and unfinished jobs cannot be reported as successful benchmarks", () => {
  const entries = ["cancelled", "skipped", null].map(conclusion => measureJob(run, { ...job, conclusion }));
  assert.deepEqual(summarizeJobs(entries), []);
  assert.equal(measureJob(run, { ...job, completed_at: null }).timingValid, false);
});
