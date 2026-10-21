import { readFile } from "node:fs/promises";
import path from "node:path";
import { isSupportedMasteryTarget, normalizeMasteryBox } from "../../mastery.ts";
import { BUILDING_SKILL_CATALOG, OPERATOR_CATALOG, operatorBuildingSkillList } from "../../operatorPortraits.ts";
import { operatorMatchesQuery } from "../../building-rooms.ts";
import type { AgentOperatorPool } from "./calculator-tools.ts";
import englishNames from "../../generated/operator-english-names.json" with { type: "json" };
import pinyinNames from "../../generated/arkntools/operator-pinyin.json" with { type: "json" };

type OperatorAliases = Record<string, { targets?: string[] }>;

/** Only identity aliases are read; mechanism and combination indexes do not participate. */
export async function resolveAgentOperator(query: string, root = process.env.AGENT_KB_DIR?.trim()) {
  const needle = query.trim().toLowerCase();
  const exact = OPERATOR_CATALOG.filter((op) => op.name.toLowerCase() === needle || op.id === needle || op.id === `char_${needle}`);
  const project = (entries: typeof OPERATOR_CATALOG) => entries.map(({ id, name }) => ({ id, name }));
  if (exact.length) return { status: "resolved" as const, candidates: project(exact), aliasSource: "not_needed" as const };
  let aliases: OperatorAliases = {};
  let aliasSource: "available" | "unavailable" = "unavailable";
  if (root) {
    try {
      const dictionary = JSON.parse(await readFile(path.join(root, "index/消歧字典.json"), "utf8"));
      aliases = dictionary.operator_aliases ?? {};
      aliasSource = "available";
    } catch { /* Canonical names remain available without the optional external index. */ }
  }
  const targets = Object.entries(aliases).filter(([alias]) => alias.toLowerCase() === needle).flatMap(([, value]) => value.targets ?? []);
  const candidates = project(OPERATOR_CATALOG.filter((op) => targets.includes(op.name)
    || (needle.length > 0 && op.name.toLowerCase().includes(needle))
    || (englishNames as Record<string, string>)[op.name]?.toLowerCase() === needle
    || (pinyinNames as Record<string, string[]>)[op.name]?.some((value) => value.toLowerCase() === needle)));
  // A missing alias index cannot prove that a partial name has only one interpretation.
  const status = candidates.length === 0 ? "unknown" : candidates.length > 1 || aliasSource === "unavailable" ? "ambiguous" : "resolved";
  return { status, candidates, aliasSource };
}

export async function inspectMasteryTarget(pool: AgentOperatorPool, query: string) {
  const resolution = await resolveAgentOperator(query);
  const context = { source: pool.source, sourceName: pool.sourceName, isSample: pool.source === "sample", ...resolution };
  const fail = (code: string, error: string) => ({ ...context, code, error });
  if (resolution.status === "unknown") return fail("identity_unknown", `站内目录未识别「${query}」，请提供完整干员名或 ID。`);
  if (resolution.status === "ambiguous") return fail("identity_ambiguous", `请确认目标干员：${resolution.candidates.map((op) => op.name).join("、")}。`);
  const operator = resolution.candidates[0]!;
  if (!isSupportedMasteryTarget(operator.id)) return fail("calculation_unsupported", `「${operator.name}」不属于当前专精计算器支持的目标。`);
  const entry = normalizeMasteryBox(pool.operbox).find((op) => op.id === operator.id);
  const ownershipKnown = pool.source !== "sample" && (!!entry || pool.source === "skland");
  const own = ownershipKnown ? entry?.own ?? false : null;
  const elite = own ? entry!.elite : null;
  const warnings: { code: "not_owned" | "ownership_unknown" | "insufficient_training"; message: string }[] = [];
  if (!ownershipKnown) {
    warnings.push({ code: "ownership_unknown", message: `当前${pool.sourceName}无法确认「${operator.name}」的个人持有与练度；可按已获得且精二的前提计算，实际训练前需确认满足条件。` });
  } else if (!own) {
    warnings.push({ code: "not_owned", message: `当前${pool.sourceName}中未持有「${operator.name}」；可按已获得且精二的前提计算，实际训练前需先获得并提升至精二。` });
  } else if (elite !== 2) {
    warnings.push({ code: "insufficient_training", message: `「${operator.name}」当前精${elite}，练度不足；可按精二前提计算，实际训练前需提升至精二。` });
  }
  return { ...context, operator, ownershipKnown, own, elite, eligible: true, warnings,
    targetAssumptions: { owned: true, elite: 2 as const } };
}

export function queryAgentSkills(input: { query: string; tag?: string; limit?: number }) {
  const needle = input.query.trim().toLowerCase();
  const tag = input.tag?.trim().toLowerCase();
  const exact = OPERATOR_CATALOG.filter((op) => op.name.toLowerCase() === needle || op.id === needle);
  const operators = exact.length ? exact : OPERATOR_CATALOG.filter((op) => operatorMatchesQuery(op.name, op.buildingSkills.map((s) => s.id), needle, (id) => BUILDING_SKILL_CATALOG[id], englishNames, pinyinNames)
    || op.buildingSkills.some((s) => BUILDING_SKILL_CATALOG[s.id]?.tags.some((t) => t.toLowerCase().includes(needle))));
  const all = operators.flatMap((op) => operatorBuildingSkillList(op.name)
    .filter((s) => (!tag || s.tags.some((t) => t.toLowerCase().includes(tag))) && (exact.length > 0 || operatorMatchesQuery(op.name, [], needle, () => undefined, englishNames, pinyinNames)
      || [s.name, s.description, ...s.tags].some((v) => v.toLowerCase().includes(needle))))
    .map((s) => ({ operator: op.name, operatorId: op.id, id: s.id, name: s.name, description: s.description, tags: s.tags, elite: s.elite, level: s.level })));
  const skills = all.slice(0, input.limit ?? 12);
  return { query: input.query, matchedCount: all.length, skills, truncated: skills.length < all.length };
}

export function inspectAgentOperators(pool: AgentOperatorPool, names: string[]) {
  return names.map((name) => {
    const entry = pool.operbox.find((op) => op.name === name.trim() || op.id === name.trim());
    const catalogEntry = OPERATOR_CATALOG.find((op) => op.name === name.trim() || op.id === name.trim());
    const known = pool.source !== "sample" && (!!entry || (pool.source === "skland" && !!catalogEntry));
    return { name: entry?.name ?? catalogEntry?.name ?? name, id: entry?.id ?? catalogEntry?.id ?? null, ownershipKnown: known,
      own: known ? entry?.own ?? false : null, elite: known && entry?.own ? entry.elite : null,
      level: known && entry?.own ? entry.level : null };
  });
}
