"use client";

import { lazyWithMessages } from "@/i18n/features-client";
import { useTranslations, useLocale } from "use-intl";

import { Suspense } from "react";

import { OperatorSlot } from "@/components";
import { RichText } from "@/components/RichText";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  BUILDING_SKILL_CATALOG,
  buildingSkillPrefixFor,
  isBuildingSkillEnhanced,
  type OperatorAssetRecord,
  type OperatorBuildingSkillRef,
} from "@/operatorPortraits";
import { skillAnnotationKey } from "@/skill-annotations";
import type { SkillAnnotationData } from "@riic/arknights-domain/types";
import { localizedBuildingSkill, localizedOperatorName } from "@/i18n/game-data";
import { useGameCatalog } from "@/i18n/game-data-client";
import { Skeleton } from "@/components/ui/skeleton";
import { BuildingSkillUnlockText, SkillAnnotationNote } from "./SkillText";

const MobileSkillList = lazyWithMessages(() => import("./MobileSkillList"), "apps/arknights/src/components/skill-query/MobileSkillList.tsx");

/** 按「最后一个下划线之前」的前缀分组：同一族（基础 + 提升）分到同一组，行内按 index 升序。 */
function groupSkillsByPrefix(skills: OperatorBuildingSkillRef[]): OperatorBuildingSkillRef[][] {
  const groups: OperatorBuildingSkillRef[][] = [];
  const byKey = new Map<string, OperatorBuildingSkillRef[]>();
  for (const ref of skills) {
    const key = buildingSkillPrefixFor(ref.id) || ref.id;
    const group = byKey.get(key);
    if (group) {
      group.push(ref);
    } else {
      // 关键：两个 map 必须共享同一个数组引用，后续 push 才能同时反映到 groups
      const newGroup = [ref];
      byKey.set(key, newGroup);
      groups.push(newGroup);
    }
  }
  return groups;
}

interface SkillResultRowProps {
  operator: OperatorAssetRecord;
  annotationIndex: ReadonlyMap<string, SkillAnnotationData>;
}

export function SkillResultRow({ operator, annotationIndex }: SkillResultRowProps) {
  const intl = useTranslations();
  const isMobile = useIsMobile();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const displayName = localizedOperatorName(operator.name, locale, gameCatalog);
  const skills = [...operator.buildingSkills].sort((left, right) => left.index - right.index);

  return (
    <article
      className="infra-room-surface min-w-0 overflow-hidden px-4 py-4"
      aria-label={intl("components_skill_query_SkillResultRow.sInfrastructureSkills", { name: locale === "en" ? (((displayName))) : (((operator.name))) })}
    >
      {/* 左右布局：左侧干员卡片（不展示心情），右侧技能（PC 每技能一列，移动端按钮列表+弹窗） */}
      <div className="relative z-10 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
        <div className="shrink-0">
          <OperatorSlot
            slot={{
              name: operator.name,
              label: operator.name,
              portrait: operator.portrait,
              profession: operator.profession,
            }}
          />
        </div>
        {isMobile ? (
          <Suspense fallback={<Skeleton className="h-24 w-full rounded-lg" />}>
            <MobileSkillList operatorId={operator.id} skills={skills} annotationIndex={annotationIndex} />
          </Suspense>
        ) : (
          /* PC：按同前缀家族分行，基础 + 提升放同一行，孤例技能单独一行 */
          <div className="flex min-w-0 flex-col gap-3">
            {skills.length ? (
              groupSkillsByPrefix(skills).map((group) => (
                <div key={group[0]?.id} className="flex min-w-0 gap-3">
                  {group.map((ref) => (
                    <SkillColumn
                      key={ref.id}
                      index={ref.index}
                      id={ref.id}
                      elite={ref.elite}
                      level={ref.level}
                      enhanced={isBuildingSkillEnhanced(skills, ref)}
                      annotation={annotationIndex.get(skillAnnotationKey(operator.id, ref.id))?.note}
                    />
                  ))}
                </div>
              ))
            ) : (
              <span className="text-sm text-white/55">{intl("components_skill_query_SkillResultRow.noSkillData")}</span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function SkillColumn({
  index,
  id,
  elite,
  level,
  enhanced,
  annotation,
}: {
  index: number;
  id: string;
  elite: number;
  level: number;
  enhanced: boolean;
  annotation?: string;
}) {
  const intl = useTranslations();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const sourceSkill = BUILDING_SKILL_CATALOG[id];
  const skill = sourceSkill ? localizedBuildingSkill(id, locale, sourceSkill, gameCatalog) : undefined;

  if (!skill) {
    return (
      <span className="text-sm text-white/55">
        S<span className="font-number">{index}</span> {intl("components_skill_query_SkillResultRow.noSkillData")}
      </span>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center border border-white/10 bg-black/24 px-3 py-3">
      {/* 两列：第一列 图标+名字+解锁条件（原工作房间位置），第二列 技能描述 */}
      <div className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <img src={skill.icon} alt="" className="size-8 shrink-0 object-contain" aria-hidden="true" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">
              {skill.name}
            </div>
            <div className="mt-0.5 text-[11px] text-white/55">
              <BuildingSkillUnlockText elite={elite} level={level} enhanced={enhanced} />
            </div>
          </div>
        </div>
        <p className="min-w-0 text-pretty text-sm leading-5 text-white/70">
          {skill.descriptionRich ? <RichText text={skill.descriptionRich} /> : skill.description}
        </p>
      </div>
      {annotation ? <SkillAnnotationNote note={annotation} /> : null}
    </div>
  );
}
