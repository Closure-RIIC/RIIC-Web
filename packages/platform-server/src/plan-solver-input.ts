import type { OperBoxEntry } from "@riic/arknights-domain/types";

// These operators are available in the web catalog but not the deployed solver.
// Remove each entry only after the solver's corresponding skills are supported.
const PENDING_SOLVER_OPERATORS = [
  ["char_4169_caledo", "镜匠"],
  ["char_4170_hdbell", "行铃"],
  ["char_4244_tocka", "冻河"],
  ["char_4245_alga", "奥尔佳"],
  ["char_4246_dminon", "国度"],
  ["char_4247_oxi", "塔露拉"],
] as const;
const SKIPPED_OPERATOR_NAMES = new Set<string>([
  "阿米娅（近卫）", "阿米娅（医疗）",
  ...PENDING_SOLVER_OPERATORS.map(([, name]) => name),
]);
const SKIPPED_OPERATOR_IDS = new Set<string>(PENDING_SOLVER_OPERATORS.map(([id]) => id.replace(/^char_/, "")));

export function normalizeSolverOperbox(operbox: readonly OperBoxEntry[]): OperBoxEntry[] {
  const seenNames = new Set<string>();
  return operbox.filter((entry) => {
    if (!entry.own) return false;
    if (SKIPPED_OPERATOR_IDS.has(entry.id.trim().replace(/^char_/, ""))) return false;
    const name = entry.name.trim();
    if (SKIPPED_OPERATOR_NAMES.has(name) || seenNames.has(name)) return false;
    seenNames.add(name);
    return true;
  });
}
