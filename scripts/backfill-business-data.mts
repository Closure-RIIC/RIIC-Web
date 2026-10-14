import { loadEnvConfig } from "./load-env.mjs";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

import { legacyFeedbackSummary, legacyPlanRunSummary } from "../src/server/business-backfill.ts";
import { BUSINESS_DATA_TTL_MS } from "../src/server/business-config.ts";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for business-data backfill.");
const storageRoot = path.resolve(process.env.BETA_STORAGE_DIR || path.join(process.cwd(), "server", "storage"));
const runRoot = path.resolve(process.env.BETA_CLI_RUN_DIR || path.join(storageRoot, "cli-runs"));
const feedbackRoot = path.resolve(process.env.BETA_FEEDBACK_DIR || path.join(storageRoot, "feedback"));
const cutoff = Date.now() - BUSINESS_DATA_TTL_MS;
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const report = { runs: { scanned: 0, inserted: 0, existing: 0 }, feedback: { scanned: 0, inserted: 0, existing: 0 }, skipped: new Map<string, number>() };

function skip(reason: string) {
  report.skipped.set(reason, (report.skipped.get(reason) ?? 0) + 1);
}

async function directories(root: string) {
  return (await readdir(root, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name));
}

async function json(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function artifact(key: string, files: string[]) {
  const values = await Promise.all(files.map((file) => readFile(file)));
  const hash = createHash("sha256");
  let bytes = 0;
  for (const value of values) { bytes += value.byteLength; hash.update(value); }
  return { key, bytes, sha256: hash.digest("hex") };
}

try {
  for (const directory of await directories(runRoot)) {
    report.runs.scanned += 1;
    try {
      const details = await stat(directory);
      if (details.mtimeMs < cutoff) { skip("run_expired"); continue; }
      const resultPath = path.join(directory, "result.json");
      const operbox = await json(path.join(directory, "operbox.json"));
      const summary = legacyPlanRunSummary({
        result: await json(resultPath),
        owner: await json(path.join(directory, "owner.json")).catch(() => null),
        layout: await json(path.join(directory, "layout.json")),
        operboxCount: Array.isArray(operbox) ? operbox.length : 0,
        artifact: await artifact(path.basename(directory).split("_").at(-1) ?? "legacy", [resultPath]),
        directoryCreatedAt: details.mtime,
      });
      if (!summary) { skip("run_unrecognized"); continue; }
      if (summary.createdAt!.getTime() < cutoff) { skip("run_expired"); continue; }
      const inserted = await pool.query(
        `INSERT INTO app.plan_run
          (diagnostic_id, user_id, data_owner_tag, source_type, status, layout_template, room_count, operator_count,
           rotation, fiammetta_enable, duration_ms, error_code, solver_executable_sha256, protocol_version,
           plan_schema_version, artifact_key, artifact_bytes, artifact_sha256, created_at, expires_at)
         VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (diagnostic_id) DO NOTHING RETURNING diagnostic_id`,
        [summary.diagnosticId, summary.dataOwnerTag, summary.sourceType, summary.status, summary.layoutTemplate,
          summary.roomCount, summary.operatorCount, summary.rotation, summary.fiammettaEnable, summary.durationMs,
          summary.solver?.solver_executable_sha256, summary.solver?.protocol_version, summary.solver?.plan_schema_version,
          summary.artifact?.key, summary.artifact?.bytes, summary.artifact?.sha256, summary.createdAt,
          new Date(summary.createdAt!.getTime() + BUSINESS_DATA_TTL_MS)],
      );
      if (inserted.rowCount) report.runs.inserted += 1; else report.runs.existing += 1;
    } catch { skip("run_corrupt"); }
  }

  for (const directory of await directories(feedbackRoot)) {
    report.feedback.scanned += 1;
    try {
      const details = await stat(directory);
      if (details.mtimeMs < cutoff) { skip("feedback_expired"); continue; }
      const metaPath = path.join(directory, "meta.json");
      const issuePath = path.join(directory, "issue.json");
      const summary = legacyFeedbackSummary({
        meta: await json(metaPath), issue: await json(issuePath),
        artifact: await artifact(path.basename(directory).split("_").at(-1) ?? "legacy", [metaPath, issuePath]),
        directoryCreatedAt: details.mtime,
      });
      if (!summary) { skip("feedback_unrecognized"); continue; }
      if (summary.savedAt.getTime() < cutoff) { skip("feedback_expired"); continue; }
      const linked = await pool.query<{ user_id: string | null }>("SELECT user_id FROM app.plan_run WHERE diagnostic_id = $1", [summary.diagnosticId]);
      const inserted = await pool.query(
        `INSERT INTO app.feedback
          (id, diagnostic_id, plan_run_diagnostic_id, user_id, kind, room, note, consent_at, status,
           artifact_key, artifact_bytes, artifact_sha256, created_at, updated_at, expires_at)
         VALUES ($1,$2,CASE WHEN EXISTS (SELECT 1 FROM app.plan_run WHERE diagnostic_id=$2) THEN $2 ELSE NULL END,
          $3,$4,$5,$6,$7,'unreviewed',$8,$9,$10,$7,$7,$11)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [summary.feedbackId, summary.diagnosticId, linked.rows[0]?.user_id ?? null, summary.kind,
          summary.room ? JSON.stringify(summary.room) : null, summary.note, summary.savedAt,
          summary.artifact.key, summary.artifact.bytes, summary.artifact.sha256,
          new Date(summary.savedAt.getTime() + BUSINESS_DATA_TTL_MS)],
      );
      await pool.query(
        "INSERT INTO app.feedback_event (id, feedback_id, status, note, created_at) VALUES ($1,$2,'unreviewed',NULL,$3) ON CONFLICT (id) DO NOTHING",
        [`${summary.feedbackId}:backfill`, summary.feedbackId, summary.savedAt],
      );
      if (inserted.rowCount) report.feedback.inserted += 1; else report.feedback.existing += 1;
    } catch { skip("feedback_corrupt"); }
  }

  const counts = await pool.query<{ runs: number; feedback: number }>(
    "SELECT (SELECT count(*)::int FROM app.plan_run) runs, (SELECT count(*)::int FROM app.feedback) feedback",
  );
  console.log(JSON.stringify({
    runs: report.runs,
    feedback: report.feedback,
    skipped: Object.fromEntries(report.skipped),
    databaseRows: counts.rows[0],
  }, null, 2));
} finally {
  await pool.end();
}
