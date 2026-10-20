import type { OperBoxEntry } from "../types.ts";

const SKIPPED_OPERATOR_NAMES = new Set(["阿米娅（近卫）", "阿米娅（医疗）"]);

export function normalizeSolverOperbox(operbox: readonly OperBoxEntry[]): OperBoxEntry[] {
  const seenNames = new Set<string>();
  return operbox.filter((entry) => {
    if (!entry.own) return false;
    const name = entry.name.trim();
    if (SKIPPED_OPERATOR_NAMES.has(name) || seenNames.has(name)) return false;
    seenNames.add(name);
    return true;
  });
}
