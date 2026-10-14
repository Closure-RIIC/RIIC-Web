import { loadEnvConfig } from "./load-env.mjs";


async function bootstrap(): Promise<void> {
  // Runtime modules resolve solver and storage paths during module evaluation,
  // so the sealed standalone environment must be loaded before importing them.
  loadEnvConfig(process.cwd());
  const { runPlanWorker } = await import("./plan-worker-runtime.mts");
  await runPlanWorker();
}

void bootstrap().catch((error) => {
  console.error("[plan-worker] fatal:", error);
  process.exitCode = 1;
});
