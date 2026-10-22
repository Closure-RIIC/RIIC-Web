import { loadEnvConfig } from "./load-env.mjs";
async function main() {
  loadEnvConfig(process.cwd());
  const { runQualityWorker, stopQualityWorker } = await import("../apps/arknights/src/server/quality/worker.ts");
  process.on("SIGTERM", stopQualityWorker);
  process.on("SIGINT", stopQualityWorker);
  try { await runQualityWorker(); }
  catch (error) { console.error(error instanceof Error ? error.message : "Quality worker failed"); process.exitCode = 1; }
  const { getDatabasePool } = await import("@riic/platform-server/db");
  await getDatabasePool().end();
}
void main();
