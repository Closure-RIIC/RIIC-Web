import { and, gte, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "./db/schema.ts";

export function buildAdminSolverTrendQuery(
  database: NodePgDatabase<typeof schema>,
  startedAt: Date,
  endedAt: Date,
  bucketSeconds: number,
) {
  if (!Number.isSafeInteger(bucketSeconds) || bucketSeconds <= 0) {
    throw new Error("Solver metric trend bucket must be a positive integer.");
  }

  // The same bucket expression appears in SELECT, GROUP BY, and ORDER BY.
  // A bound value would become a different PostgreSQL placeholder each time,
  // so embed this trusted internal constant to preserve expression identity.
  const bucketSecondsLiteral = sql.raw(String(bucketSeconds));
  // sql<Date> only describes the TypeScript result; computed SQL expressions do
  // not inherit a runtime decoder. Reuse the timestamp column decoder so the
  // metrics formatter receives a Date instead of PostgreSQL's timestamp string.
  const trendBucket = sql`to_timestamp(floor(extract(epoch from ${schema.planRun.createdAt}) / ${bucketSecondsLiteral}) * ${bucketSecondsLiteral})`
    .mapWith(schema.planRun.createdAt);

  return database.select({
    bucketStartedAt: trendBucket,
    successCount: sql<number>`count(*) filter (where ${schema.planRun.status} = 'success')::int`,
    failureCount: sql<number>`count(*) filter (where ${schema.planRun.status} = 'failed')::int`,
    averageDurationMs: sql<number | null>`round(avg(${schema.planRun.durationMs}) filter (where ${schema.planRun.status} = 'success' and ${schema.planRun.durationMs} is not null))::int`,
  }).from(schema.planRun).where(and(
    gte(schema.planRun.createdAt, startedAt),
    lte(schema.planRun.createdAt, endedAt),
  )).groupBy(trendBucket).orderBy(trendBucket);
}
