"use client";
import { localize as localize_components_skill_query_SkillResultRow } from "../../i18n/helpers/components_skill_query_SkillResultRow.ts";

import { useTranslations, useLocale } from "use-intl";

import { useState } from "react";

import { OperatorSlot } from "@/components";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RichText } from "@/components/RichText";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  BUILDING_SKILL_CATALOG,
  BUILDING_SKILL_ENHANCED_WORD,
  buildingSkillPrefixFor,
  buildingSkillUnlockLabel,
  buildingSkillUnlockLabelEnglish,
  buildingSkillUnlockPrefix,
  isBuildingSkillEnhanced,
  type OperatorAssetRecord,
  type OperatorBuildingSkillRef,
} from "@/operatorPortraits";
import { skillAnnotationKey } from "@/skill-annotations";
import type { SkillAnnotationData } from "@/types";
import { localizedBuildingSkill, localizedOperatorName } from "@/i18n/game-data";
import { useGameCatalog } from "@/i18n/game-data-client";

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

/** 强化技能的尾词用一图流同款蓝色。 */
function BuildingSkillUnlockText({ elite, level, enhanced }: { elite: number; level: number; enhanced: boolean }) {
  const locale = useLocale();
  if (locale === "en") return <>{buildingSkillUnlockLabelEnglish(elite, level, enhanced)}</>;
  if (!enhanced) return <>{buildingSkillUnlockLabel(elite, level)}</>;
  return (
    <>
      <span>{buildingSkillUnlockPrefix(elite, level)}</span>
      <span className="text-[#22BBFF]">{BUILDING_SKILL_ENHANCED_WORD}</span>
    </>
  );
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
      aria-label={intl("components_skill_query_SkillResultRow.sInfrastructureSkills", { displayName: (locale === "en") ? (displayName) : "", name: (locale === "en") ? "" : (operator.name) })}
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
          <MobileSkillList operatorId={operator.id} skills={skills} annotationIndex={annotationIndex} />
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

function SkillAnnotationNote({ note, light = false }: { note: string; light?: boolean }) {
  const intl = useTranslations();

  return (
    <span
      className={`mt-2 flex w-full gap-1.5 border-t pt-2 text-left text-xs leading-5 ${light ? "border-border/70 text-muted-foreground" : "border-[#FFD501]/25 text-white/68"}`}
      data-skill-annotation
    >
      <span className="shrink-0 font-semibold text-[#E5B900]" aria-hidden="true">*</span>
      <span><span className="sr-only">{intl("components_skill_query_SkillResultRow.manualNote")}</span>{note}</span>
    </span>
  );
}

function MobileSkillList({
  operatorId,
  skills,
  annotationIndex,
}: {
  operatorId: string;
  skills: OperatorBuildingSkillRef[];
  annotationIndex: ReadonlyMap<string, SkillAnnotationData>;
}) {
  const intl = useTranslations();
  const [selected, setSelected] = useState<OperatorBuildingSkillRef | null>(null);
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const en = locale === "en";

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {skills.length ? (
        skills.map((ref) => {
          const sourceSkill = BUILDING_SKILL_CATALOG[ref.id];
          const skill = sourceSkill ? localizedBuildingSkill(ref.id, locale, sourceSkill, gameCatalog) : undefined;
          const annotation = annotationIndex.get(skillAnnotationKey(operatorId, ref.id))?.note;
          return (
            <button
              key={ref.id}
              type="button"
              onClick={() => setSelected(ref)}
              className="flex min-h-11 flex-col items-start justify-center rounded-lg border border-white/10 bg-black/24 px-2.5 py-2 text-left text-sm font-medium text-white outline-none transition-colors hover:bg-black/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#FFD800]"
              aria-label={localize_components_skill_query_SkillResultRow.text(en, "additional1", { choice1: ((en)) && (skill) ? "yes" : "no", value2: ((en) && (skill)) ? String(ref.index) : "", value3: ((en) && (skill)) ? String(skill.name) : "", choice4: (!(en)) && (skill) ? "yes" : "no", value5: (!(en) && (skill)) ? String(ref.index) : "", value6: (!(en) && (skill)) ? String(skill.name) : "" })}
            >
              {skill ? (
                <span className="flex min-w-0 items-center gap-2">
                  <img src={skill.icon} alt="" className="size-7 shrink-0 object-contain" aria-hidden="true" />
                  <span className="truncate">
                    {skill.name}
                  </span>
                </span>
              ) : (
                <span className="text-white/55">
                  S<span className="font-number">{ref.index}</span> {intl("components_skill_query_SkillResultRow.noSkillData")}
                </span>
              )}
              {annotation ? <SkillAnnotationNote note={annotation} /> : null}
            </button>
          );
        })
      ) : (
        <span className="text-sm text-white/55">{intl("components_skill_query_SkillResultRow.noSkillData")}</span>
      )}
      <SkillDetailDialog
        selected={selected}
        enhanced={selected !== null ? isBuildingSkillEnhanced(skills, selected) : false}
        annotation={selected ? annotationIndex.get(skillAnnotationKey(operatorId, selected.id))?.note : undefined}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function SkillDetailDialog({
  selected,
  enhanced,
  annotation,
  onClose,
}: {
  selected: OperatorBuildingSkillRef | null;
  enhanced: boolean;
  annotation?: string;
  onClose: () => void;
}) {
  const intl = useTranslations();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();

  const sourceSkill = selected ? BUILDING_SKILL_CATALOG[selected.id] : undefined;
  const skill = selected && sourceSkill ? localizedBuildingSkill(selected.id, locale, sourceSkill, gameCatalog) : undefined;
  const unlockLabel = selected ? buildingSkillUnlockLabel(selected.elite, selected.level, enhanced) : "";

  return (
    <Dialog
      open={selected !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader className=" pb-0">
          <DialogTitle>
            {skill ? (
              <span className="flex min-w-0 items-center gap-2">
                <img src={skill.icon} alt="" className="size-7 shrink-0 object-contain" aria-hidden="true" />
                <span className="truncate">
                  {skill.name}
                </span>
              </span>
            ) : (
              <span>
                S<span className="font-number">{selected?.index}</span> {intl("components_skill_query_SkillResultRow.noSkillData")}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="gap-2">
          <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span>
              {selected ? (
                <BuildingSkillUnlockText elite={selected.elite} level={selected.level} enhanced={enhanced} />
              ) : (
                unlockLabel
              )}
            </span>
          </div>
          {skill ? (
            <p className="text-pretty text-sm leading-6 text-foreground">
              {skill.descriptionRich ? <RichText text={skill.descriptionRich} /> : skill.description}
            </p>
          ) : null}
          {annotation ? <SkillAnnotationNote note={annotation} light /> : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
