"use client";

import { useLocale, useTranslations } from "use-intl";
import { buildingSkillUnlockLabel, buildingSkillUnlockPrefix, buildingSkillUnlockSuffix } from "@/operatorPortraits";

/** 强化技能的尾词用一图流同款蓝色。 */
export function BuildingSkillUnlockText({ elite, level, enhanced }: { elite: number; level: number; enhanced: boolean }) {
  const locale = useLocale();
  if (!enhanced) return <>{buildingSkillUnlockLabel(elite, level, false, locale)}</>;
  return (
    <>
      <span>{buildingSkillUnlockPrefix(elite, level, locale)}</span>
      <span className="text-[#22BBFF]">{buildingSkillUnlockSuffix(true, locale)}</span>
    </>
  );
}

export function SkillAnnotationNote({ note, light = false }: { note: string; light?: boolean }) {
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
