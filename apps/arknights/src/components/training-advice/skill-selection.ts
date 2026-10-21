import {
  operatorBuildingSkillList,
  type BuildingSkillPresentation,
} from "../../operatorPortraits.ts";
import type { TrainingAdviceState, TrainingAdviceTarget } from "../../types.ts";

type SkillLevel = Pick<TrainingAdviceState, "elite" | "level">;

export interface TrainingAdviceSkillSummary {
  skills: BuildingSkillPresentation[];
  highlightedSkillIds: string[];
}

function levelScore(value: Partial<SkillLevel> | undefined): number | null {
  if (typeof value?.elite !== "number") return null;
  return value.elite * 100_000 + (value.level ?? 1);
}

function targetLevelScore(target: TrainingAdviceTarget | undefined): number | null {
  if (!target || target.kind === "no_requirement" || target.kind === "needs_review") return null;
  return levelScore(target);
}

/**
 * 展示干员全部基建技能，并标出从当前练度升到本次目标时会解锁或强化的技能。
 * 练卡协议暂不含 skill_id，因此这里只根据协议给出的解锁练度做确定性标注，不猜技能联动。
 */
export function trainingAdviceSkillSummary(
  operator: string,
  current?: Partial<SkillLevel>,
  target?: TrainingAdviceTarget,
): TrainingAdviceSkillSummary {
  const skills = operatorBuildingSkillList(operator);
  const targetScore = targetLevelScore(target);
  if (!skills.length || targetScore === null) return { skills, highlightedSkillIds: [] };

  const currentScore = levelScore(current);
  if (currentScore !== null) {
    return {
      skills,
      highlightedSkillIds: skills
        .filter((skill) => {
          const score = levelScore(skill);
          return score !== null && score > currentScore && score <= targetScore;
        })
        .map((skill) => skill.id),
    };
  }

  const unlockedAtTarget = skills.filter((skill) => {
    const score = levelScore(skill);
    return score !== null && score <= targetScore;
  });
  const latestScore = Math.max(...unlockedAtTarget.map((skill) => levelScore(skill) ?? -1));
  return {
    skills,
    highlightedSkillIds: unlockedAtTarget
      .filter((skill) => levelScore(skill) === latestScore)
      .map((skill) => skill.id),
  };
}

export function legacyTrainingTarget(requirement?: string): TrainingAdviceTarget | undefined {
  const matchedElite = requirement?.match(/(?:精(?:英)?\s*|elite\s*)([012])/i)?.[1];
  if (matchedElite === undefined) return undefined;
  return { kind: "explicit", elite: Number(matchedElite), level: 1 };
}
