"use client";
import { useTranslations, useLocale } from "next-intl";

import { lazy, Suspense } from "react";

import { InfraTechnicalCard } from "@/components/InfraTechnicalCard";
import {
  operatorBuildingSkillList,
  operatorPortraitFor,
  operatorProfessionFor,
  operatorProfessionLabelEnglishForCode,
  operatorProfessionPresentation,
} from "@/operatorPortraits";
import { cn } from "@/lib/utils";
import type { TrainingCombination, TrainingAdviceMember } from "@/types";
import { localizedOperatorName } from "@/i18n/game-data";
import { useGameCatalog } from "@/i18n/game-data-client";

import {
  trainingCombinationStateLabel,
  trainingFacilityLabel,
  trainingLevelText,
  trainingMemberProgressLabel,
  trainingMemberRoleLabel,
  trainingProductGroup,
  trainingProductLabel,
  trainingScaleLabel,
} from "./presentation";

const OperatorSkillTooltip = lazy(() => import("@/components/OperatorSkillTooltip").then((module) => ({
  default: module.OperatorSkillTooltip,
})));

const STATE_CLASSES: Record<string, string> = {
  complete: "border-emerald-400/60 bg-emerald-400/10 text-emerald-300",
  needs_training: "border-amber-400/60 bg-amber-400/10 text-amber-300",
  missing_core: "border-red-400/70 bg-red-400/10 text-red-300",
  missing_important: "border-orange-400/60 bg-orange-400/10 text-orange-300",
  needs_review: "border-sky-400/60 bg-sky-400/10 text-sky-300",
};

function MemberRow({ member }: { member: TrainingAdviceMember }) {
  const intl = useTranslations();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const en = locale === "en";
  const isReady = member.progress === "ready";
  const isMissing = member.progress === "missing";
  // 就绪：浅灰背景；需培养（需精2 等）：琥珀色边框与状态字同色；缺失保持原样。
  const cardClass = isReady
    ? "border-white/10 bg-white/10"
    : isMissing
      ? "border-white/10 bg-black/18"
      : "border-amber-300/70 bg-black/18";
  const statusClass = isReady
    ? "text-emerald-300"
    : isMissing
      ? "text-red-300"
      : "text-amber-300";
  const statusText = member.progress === "needs_review"
    ? trainingMemberProgressLabel(member.progress, en)
    : isReady
    ? (intl("components_training_advice_TrainingCombinationCard.ready"))
    : isMissing
      ? (intl("components_training_advice_TrainingCombinationCard.missing"))
      : member.target
        ? `${intl("components_training_advice_TrainingCombinationCard.needs")}${trainingLevelText(member.target, en)}`
        : trainingMemberProgressLabel(member.progress, en);
  const roleClass =
    member.role === "core"
      ? "border-white/20 bg-white/10 text-white"
      : "border-white/10 bg-white/5 text-white/65";
  const hasSkills = operatorBuildingSkillList(member.operator).length > 0;
  const professionCode = operatorProfessionFor(member.operator);
  const profession = operatorProfessionPresentation(member.operator);
  const professionLabel = en
    ? operatorProfessionLabelEnglishForCode(professionCode)
    : profession?.label;
  const professionHeader = profession && professionLabel ? (
    <span
      className="flex w-full items-center gap-2 border-b border-background/15 pb-2"
      data-operator-profession
    >
      <img src={profession.icon} alt="" aria-hidden="true" className="size-7 shrink-0 object-contain" />
      <span className="text-xs font-semibold text-background/85">
        {professionLabel}
      </span>
    </span>
  ) : null;
  const content = (
    <>
      <span className="size-8 shrink-0 overflow-hidden border border-white/10 bg-[#272A2B]">
        <img src={operatorPortraitFor(member.operator)} alt="" className="size-full object-cover" loading="lazy" />
      </span>
      <span className="shrink truncate text-sm text-white/85">{localizedOperatorName(member.operator, locale, gameCatalog)}</span>
      <span className={cn("shrink-0 border px-1.5 py-0.5 text-xs", roleClass)}>
        {trainingMemberRoleLabel(member.role, en)}
      </span>
      <span className={cn("shrink-0 text-xs tabular-nums", statusClass)}>
        {statusText}
      </span>
    </>
  );
  const cardClassName = cn("flex min-w-0 items-center gap-1.5 border px-2 py-1", cardClass);
  const cardButton = (
    <button type="button" className={cardClassName}>
      {content}
    </button>
  );
  if (!hasSkills) return <div className={cardClassName}>{content}</div>;
  return (
    <Suspense fallback={cardButton}>
      <OperatorSkillTooltip
        name={member.operator}
        trigger={cardButton}
        header={professionHeader}
        currentElite={member.owned ? member.current?.elite : null}
        currentLevel={member.owned ? member.current?.level : undefined}
      />
    </Suspense>
  );
}

export function TrainingCombinationCard({ combination }: { combination: TrainingCombination }) {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale === "en";
  return (
    <InfraTechnicalCard
      group={trainingProductGroup(combination.product)}
      dataSlot="training-combination-card"
      showEmblem={false}
    >
      <div className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h3 className="text-base font-semibold">{combination.name}</h3>
          <span
            className={cn(
              "border px-2 py-0.5 text-xs font-semibold",
              STATE_CLASSES[combination.state ?? ""] ?? "border-white/15 bg-white/5 text-white/70",
            )}
          >
            {trainingCombinationStateLabel(combination.state, en)}
          </span>
          <span className="font-number text-xs text-white/60">
            {combination.completed_slots}/{combination.total_slots}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/50">
          <span>{trainingScaleLabel(combination.scale, en)}</span>
          <span>{trainingProductLabel(combination.product, en)}</span>
          {combination.consumer_products?.length ? (
            <span>{intl("components_training_advice_TrainingCombinationCard.covers")}{combination.consumer_products.map((product) => trainingProductLabel(product, en)).join(intl("components_training_advice_TrainingCombinationCard.label"))}</span>
          ) : null}
          {combination.facilities?.length ? (
            <span>
              {intl("components_training_advice_TrainingCombinationCard.facilities")}{combination.facilities.map((facility) => trainingFacilityLabel(facility, en)).join(intl("components_training_advice_TrainingCombinationCard.label"))}
            </span>
          ) : null}
        </div>

        <div className="mt-1 flex flex-wrap gap-2 border-t border-white/10 pt-2">
          {combination.members.map((member, index) => (
            <MemberRow key={`${member.operator}-${index}`} member={member} />
          ))}
        </div>
      </div>
    </InfraTechnicalCard>
  );
}
