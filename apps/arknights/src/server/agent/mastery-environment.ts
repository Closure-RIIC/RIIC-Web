import terms from "../../generated/arkntools/term-catalog.json" with { type: "json" };
import catalog from "../../generated/arkntools/operator-catalog.json" with { type: "json" };
import { MASTERY_ENVIRONMENTS } from "../../mastery.ts";
import type { SklandStatusSnapshot } from "../../types.ts";

const MEMBERS = { sami: "cc_g_sm", abyssal: "cc_g_abyssal", knights: "cc_tag_knight", defence: "cc_g_Defence", attack: "cc_g_Attack", siracusa: "cc_g_siracusa" } as const;
export const ENVIRONMENT_WARNING = "自动读取状态可能存在误差或延迟，如果环境加成变动，记得跟我说哦。";

export function observeMasteryEnvironment(snapshot: Pick<SklandStatusSnapshot, "infrastructure" | "operbox">) {
  const rooms = snapshot.infrastructure.rooms.filter((room) => room.group !== "processing");
  const residents = new Map(rooms.flatMap((room) => room.operators.map(({ id, name }) => ({ id, name }))).map((operator) => [operator.id, operator]));
  const environment: Record<string, number> = {};
  const matches: Record<string, string[]> = {};
  for (const [key, termId] of Object.entries(MEMBERS)) {
    const names = new Set(terms[termId].desc.split("\n").slice(1).join("").split("、"));
    matches[key] = [...residents.values()].filter((operator) => names.has(operator.name)).map((operator) => operator.name);
    environment[key] = Math.min(matches[key].length, MASTERY_ENVIRONMENTS[key]!.max ?? Infinity);
  }
  const controlOperators = rooms.filter((room) => room.group === "control").flatMap((room) => room.operators);
  const controlProviders = controlOperators.filter((operator) => {
    const entry = snapshot.operbox.find((candidate) => candidate.id === operator.id || candidate.name === operator.name);
    const meta = catalog.find((candidate) => candidate.id === operator.id || candidate.name === operator.name);
    return meta?.buildingSkills.some((skill) => /^control_train_spd_01[012]$/.test(skill.id)
      && ((skill.elite === 0 && skill.level <= 1) || (entry && entry.elite >= skill.elite && (entry.elite > skill.elite || entry.level >= skill.level))));
  }).map((operator) => operator.name);
  return { environment, matches, controlBonus: controlProviders.length > 0, controlProviders,
    storeTs: snapshot.infrastructure.storeTs, currentTs: snapshot.infrastructure.currentTs,
    warning: ENVIRONMENT_WARNING };
}
export type MasteryEnvironmentObservation = ReturnType<typeof observeMasteryEnvironment>;
