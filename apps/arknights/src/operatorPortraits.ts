import buildingSkillCatalogJson from "@riic/arknights-domain/generated/arkntools/building-skill-catalog.json" with { type: "json" };
import { operatorFor, type OperatorAssetRecord, type OperatorBuildingSkillRef } from "./operator-catalog.ts";
export { OPERATOR_CATALOG, type OperatorAssetRecord, type OperatorBuildingSkillRef } from "./operator-catalog.ts";
import sourceManifest from "@riic/arknights-domain/generated/arkntools/source.json" with { type: "json" };
import { richTextPlainText } from "./components/skill-query/rich-text.ts";
import { operatorProfessionPresentationForCode } from "./operator-presentation.ts";

export {
  BUILDING_SKILL_ENHANCED_WORD,
  PROFESSION_LABELS,
  PROFESSION_LABELS_ENGLISH,
  buildingSkillUnlockLabel,
  buildingSkillUnlockLabelEnglish,
  buildingSkillUnlockPrefix,
  buildingSkillUnlockSuffix,
  operatorProfessionLabelEnglishForCode,
} from "./operator-presentation.ts";

interface BuildingSkillRecord {
  id: string;
  name: string;
  description: string;
  descriptionRich: string;
  /** 技能固有标签（数据仓库 is + 关键词补充 + 干员级补充），用于房间下的二级筛选。 */
  tags: string[];
  icon: string;
}

type GeneratedBuildingSkillRecord = Omit<BuildingSkillRecord, "description">;

export interface BuildingSkillPresentation extends BuildingSkillRecord {
  index: number;
  elite: number;
  level: number;
  /** 该技能是否为同前缀（最后一个下划线之前）另一技能的提升版（组内 index 最大）。 */
  enhanced?: boolean;
}

/** 技能 id 的前缀：最后一个下划线之前的部分（如 train_spd&profession_020 → train_spd&profession）。 */
export function buildingSkillPrefixFor(skillId: string): string {
  const separator = skillId.lastIndexOf("_");
  return separator < 0 ? "" : skillId.slice(0, separator);
}

/**
 * 判定某个基建技能是否为同干员另一技能的提升版：
 * 按「最后一个下划线之前」的前缀分组，同前缀且数量 ≥2 时，除 index 最小者外都是提升版。
 * 两阶段时即较大的那个（如芙兰卡 train_spd&profession_020 / _021 → index 2 提升）；
 * 三阶段时（如赫拉格 dorm_rec_all&oneself_010/011/012）后两个都是提升。
 */
export function isBuildingSkillEnhanced(
  refs: readonly OperatorBuildingSkillRef[],
  ref: OperatorBuildingSkillRef,
): boolean {
  const prefix = buildingSkillPrefixFor(ref.id);
  if (!prefix) return false;
  let groupCount = 0;
  let minIndex = Infinity;
  for (const candidate of refs) {
    if (buildingSkillPrefixFor(candidate.id) !== prefix) continue;
    groupCount += 1;
    if (candidate.index < minIndex) minIndex = candidate.index;
  }
  return groupCount >= 2 && ref.index !== minIndex;
}

/** 干员全部基建技能（按 index 升序，合并目录 + 解锁条件 + enhanced）；未知干员返回空数组。 */
export function operatorBuildingSkillList(name: string): BuildingSkillPresentation[] {
  const operator = operatorFor(name.trim());
  if (!operator) return [];
  return operator.buildingSkills
    .flatMap((ref) => {
      const record = BUILDING_SKILL_CATALOG[ref.id];
      if (!record) return [];
      return [
        {
          ...record,
          index: ref.index,
          elite: ref.elite,
          level: ref.level,
          enhanced: isBuildingSkillEnhanced(operator.buildingSkills, ref),
        },
      ];
    })
    .sort((left, right) => left.index - right.index);
}

export interface OperatorPresentation {
  operator?: OperatorAssetRecord;
  portrait?: string;
  buildingSkill?: BuildingSkillPresentation;
}

const BUILDING_SKILL_VERSION = `${sourceManifest.version}-${sourceManifest.source.commit.slice(0, 12)}`;

export const BUILDING_SKILL_CATALOG = Object.fromEntries(
  Object.entries(buildingSkillCatalogJson as Record<string, GeneratedBuildingSkillRecord>).map(
    ([id, skill]) => [id, {
      ...skill,
      icon: `${skill.icon}?v=${BUILDING_SKILL_VERSION}`,
      description: richTextPlainText(skill.descriptionRich),
    }],
  ),
) as Record<string, BuildingSkillRecord>;
export function operatorPresentationFor({
  name,
  id,
  skill,
}: {
  name: string;
  id?: string;
  skill?: number;
}): OperatorPresentation {
  const operator = operatorFor(name, id);
  if (!operator) return {};

  const skillRef = Number.isInteger(skill) && Number(skill) > 0
    ? operator.buildingSkills.find((candidate) => candidate.index === skill)
    : undefined;
  const skillRecord = skillRef ? BUILDING_SKILL_CATALOG[skillRef.id] : undefined;
  return {
    operator,
    portrait: operator.portrait,
    ...(skillRef && skillRecord
      ? {
          buildingSkill: {
            ...skillRecord,
            index: skillRef.index,
            elite: skillRef.elite,
            level: skillRef.level,
            enhanced: isBuildingSkillEnhanced(operator.buildingSkills, skillRef),
          },
        }
      : {}),
  };
}

export function operatorPortraitFor(name: string, id?: string): string | undefined {
  return operatorPresentationFor({ name, id }).portrait;
}

export function operatorProfessionFor(name: string): number | undefined {
  return operatorFor(name.trim())?.profession;
}

export function operatorProfessionPresentation(
  name: string,
): { label: string; icon: string } | undefined {
  return operatorProfessionPresentationForCode(operatorProfessionFor(name));
}
