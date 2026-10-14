import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { githubFindings, reconcile } from "./maintenance-loop.mjs";

// Reuse recorded observations, without a network request or fabricated human feedback.
const path = process.argv[2];
if (!path || process.argv.length > 4) throw new Error("Usage: node scripts/maintenance-loop-replay.mjs run.json [replay.json]");
const report = JSON.parse(readFileSync(path, "utf8"));
assert.equal(report.schemaVersion, 1);
assert.equal(report.status, "complete", "Incomplete observations cannot prove a successful replay");
assert.ok(report.observations, "Use an observation produced by policy version 2");
const { runs, issues, scheduled } = report.observations;
const current = [
  ...report.findings.filter((item) => item.source !== "github" && item.presence === "observed"),
  ...githubFindings(runs, issues, scheduled),
];
const replay = reconcile(current, report, report.sources, [], report.startedAt);
const observed = replay.filter((item) => item.presence === "observed");
const unexpected = observed.filter((item) => item.change !== "unchanged");
assert.equal(unexpected.length, 0, "Same evidence must not create fresh alerts");
const output = { mode: "offline-replay", sha: report.sha, findings: observed.length, repeatedEvidenceNewAlerts: unexpected.length,
  humanAcceptance: "not_measured", sourceStatus: report.sources };
if (process.argv[3]) writeFileSync(process.argv[3], `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
