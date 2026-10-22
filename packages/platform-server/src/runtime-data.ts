import { existsSync } from "node:fs";
import path from "node:path";

export const REQUIRED_RUNTIME_DATA_FILES = [
  "operator_instances.json",
  "skill_table.json",
  "base_systems.json",
  "training_advice_knowledge.json",
] as const;

export function resolveRuntimeDataDir(cliPath: string, configuredDataDir = process.env.ARKNIGHTS_INFRA_DATA_DIR) {
  const candidates = [configuredDataDir, path.join(path.dirname(cliPath), "data")].filter(Boolean) as string[];
  return (
    candidates
      .map((candidate) => path.resolve(candidate))
      .find((candidate) => REQUIRED_RUNTIME_DATA_FILES.every((fileName) => existsSync(path.join(candidate, fileName))))
    ?? null
  );
}
