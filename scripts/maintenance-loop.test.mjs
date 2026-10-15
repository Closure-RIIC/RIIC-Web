import assert from "node:assert/strict";
import test from "node:test";
import { auditFindings, githubFindings, reconcile, renderReport } from "./maintenance-loop.mjs";

const now = "2026-10-14T08:00:00.000Z";
const sources = { audit: { status: "ok" }, github: { status: "ok" } };
const sample = { source: "audit", key: "audit:example", title: "Example", severity: "high", evidence: { range: "<2" }, next: "Review" };
const previous = (findings) => ({ findings });

test("audit errors and malformed output are unknown, never zero vulnerabilities", () => {
  assert.throws(() => auditFindings({ error: { code: "ENETUNREACH" } }, 1));
  assert.throws(() => auditFindings({}, 0));
  assert.throws(() => auditFindings({ auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: {} } }, 0));
  assert.throws(() => auditFindings({ auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: {} } }, 2));
});

test("npm exit 1 preserves actual vulnerability evidence", () => {
  const result = auditFindings({ auditReportVersion: 2, metadata: { vulnerabilities: { high: 1, total: 1 } }, vulnerabilities: {
    example: { severity: "high", range: "<2", isDirect: true, via: [{ source: 12, severity: "high", range: "<2", url: "https://example.com/advisory" }], fixAvailable: false },
  } }, 1);
  assert.equal(result[0].key, "audit:example");
  assert.equal(result[0].evidence.advisories[0].id, 12);
});

test("replay deduplicates evidence but severity changes resurface", () => {
  const first = reconcile([sample], null, sources, [], now);
  const second = reconcile([sample], previous(first), sources, [], now);
  assert.equal(second[0].change, "unchanged");
  assert.equal(reconcile([{ ...sample, severity: "critical" }], previous(second), sources, [], now)[0].change, "changed");
});

test("missing source never resolves old findings", () => {
  const first = reconcile([sample], null, sources, [], now);
  assert.equal(reconcile([], previous(first), { audit: { status: "unknown" } }, [], now)[0].presence, "unknown");
  assert.equal(reconcile([], previous(first), sources, [], now)[0].presence, "not_observed");
  const missing = reconcile([], previous(first), sources, [], now);
  assert.equal(reconcile([sample], previous(missing), sources, [], now)[0].change, "reappeared");
});

test("feedback expires, is fingerprint-bound and cannot suppress changed evidence", () => {
  const first = reconcile([sample], null, sources, [], now);
  const review = { key: sample.key, fingerprint: first[0].fingerprint, decision: "deferred", reason: "Needs reachability review", reviewUntil: "2026-10-21T00:00:00Z" };
  const reviewed = reconcile([sample], previous(first), sources, [review], now);
  assert.equal(reviewed[0].suppressed, true);
  assert.equal(reconcile([sample], previous(reviewed), sources, [], "2026-10-22T00:00:00Z")[0].suppressed, false);
  assert.equal(reconcile([sample], previous(reviewed), sources, [], "2026-10-22T00:00:00Z")[0].change, "review_due");
  assert.equal(reconcile([{ ...sample, severity: "critical" }], previous(reviewed), sources, [], now)[0].suppressed, false);
  assert.throws(() => reconcile([sample], previous(first), sources, [{ ...review, reason: "" }], now));
});

test("latest success supersedes prior failure; cancellation is not a code defect", () => {
  const base = { workflowName: "Sync", headBranch: "main", event: "schedule", status: "completed" };
  assert.equal(githubFindings([
    { ...base, createdAt: "2026-10-13", conclusion: "failure" },
    { ...base, createdAt: "2026-10-14", conclusion: "success" },
  ], [], null).length, 0);
  assert.equal(githubFindings([{ ...base, createdAt: "2026-10-14", conclusion: "cancelled" }], [], null).length, 0);
});

test("success of scheduled WebKit is not success of security audit", () => {
  const jobs = [{ name: "Static and unit checks", conclusion: "skipped", steps: [] }];
  assert.equal(githubFindings([], [], { jobs })[0].key, "coverage:scheduled-release-audit");
  assert.equal(githubFindings([], [], { jobs: [{ steps: [{ name: "Security audit", conclusion: "success" }] }] }).length, 0);
});

test("pilot refinement keeps historical failures as context and excludes diagnostic branches", () => {
  const base = { workflowName: "Post-merge release", headBranch: "develop", status: "completed" };
  const findings = githubFindings([
    { ...base, event: "workflow_dispatch", createdAt: "2026-10-13", conclusion: "failure" },
    { ...base, event: "push", createdAt: "2026-10-14", conclusion: "success" },
    { ...base, headBranch: "ops/diagnostics", event: "workflow_dispatch", createdAt: "2026-10-14", conclusion: "failure" },
  ], [], null);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "info");
  assert.equal(findings[0].evidence.newerSuccess, true);
});

test("same-title reports remain candidates without exposing their title/body", () => {
  const findings = githubFindings([], [{ number: 2, title: "same", url: "b" }, { number: 1, title: "same", url: "a" }], null);
  assert.deepEqual(findings[0].evidence.issues.map((item) => item.number), [1, 2]);
  assert.equal(findings[0].severity, "low");
});

test("a later failed run of the same condition does not create a new alert", () => {
  const first = { ...sample, evidence: { failed: "build", url: "run/1", runId: 1, sha: "a" } };
  const findings = reconcile([first], null, sources, [], now);
  const second = { ...first, evidence: { ...first.evidence, url: "run/2", runId: 2, sha: "b" } };
  assert.equal(reconcile([second], previous(findings), sources, [], now)[0].change, "unchanged");
});

test("urgent findings are not hidden by the three-item summary cap", () => {
  const findings = reconcile(Array.from({ length: 4 }, (_, i) => ({ ...sample, key: `audit:${i}` })), null, sources, [], now);
  const report = renderReport({ findings, sources, status: "complete" });
  assert.equal((report.match(/### high/gu) ?? []).length, 4);
});
