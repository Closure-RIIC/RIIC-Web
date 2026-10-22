"use client";
import { localize as localize_components_RecommendationCard } from "../i18n/helpers/components_RecommendationCard.ts";
import { useTranslations, useLocale } from "use-intl";
import { messageRecord } from "@/i18n/translate";

import { motion, useReducedMotion } from "motion/react";

import { OperatorSlot } from "@/components";
import { InfraTechnicalCard } from "@/components/InfraTechnicalCard";
import { cn } from "@/lib/utils";
import { MOTION_DURATION, MOTION_EASE_OUT } from "@/motion";
import { operatorPortraitFor, operatorProfessionFor } from "@/operatorPortraits";
import type { OperBoxEntry, UserProfileAction } from "@riic/arknights-domain/types";
import { legacyTrainingTarget, trainingAdviceSkillSummary } from "@/components/training-advice/skill-selection";
import { localizedOperatorName } from "@/i18n/game-data";
import { useGameCatalog } from "@/i18n/game-data-client";
import { recommendationCurrentState, recommendationMessage } from "./training-advice/recommendation-presentation";

const DOMAIN_GROUPS: Record<string, string> = { trade: "trading", trading: "trading", manufacture: "manufacture", manu: "manufacture", power: "power", control: "control", general: "training" };

export function recommendationDomainLabel(value: string, en = false) { return (messageRecord(en, "components_RecommendationCard_labels"))[value.toLowerCase()] ?? (localize_components_RecommendationCard.text(en, "general")); }
export function recommendationKindLabel(value: string, en = false) { return (messageRecord(en, "components_RecommendationCard_labels2"))[value.toLowerCase()] ?? (localize_components_RecommendationCard.text(en, "trainingAdvice")); }

export function RecommendationCard({ action, entry, variant = "full", index = 0, showSkillTooltip = true }: { action: UserProfileAction; entry?: OperBoxEntry; variant?: "full" | "compact"; index?: number; showSkillTooltip?: boolean }) {
  const intl = useTranslations();
  const reduceMotion = useReducedMotion();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const en = locale === "en";
  const message = recommendationMessage(action, en) || intl("components_RecommendationCard.noDetailsAvailable");
  const currentState = recommendationCurrentState(action, entry, en);
  const priority = action.priority || (intl("components_RecommendationCard.unranked"));
  const operatorName = localizedOperatorName(action.operator, locale, gameCatalog) || (intl("components_RecommendationCard.unknownOperator"));
  const isHighPriority = /高|urgent|critical|p0|p1/i.test(priority);
  const skillSummary = trainingAdviceSkillSummary(
    action.operator,
    action.current_elite !== undefined || entry
      ? { elite: action.current_elite ?? entry?.elite, level: entry?.level }
      : undefined,
    legacyTrainingTarget(action.tier_up_requirement),
  );
  const content = variant === "compact" ? (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border/60 py-3 last:border-0" data-recommendation-card="compact">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <strong className="text-foreground">{operatorName}</strong><span aria-hidden="true">·</span><span>{recommendationDomainLabel(action.domain_id, en)}</span><span aria-hidden="true">·</span><span>{recommendationKindLabel(action.kind, en)}</span>
        </div>
        <p className="mt-1 text-sm leading-5 text-foreground/80">{message}</p>
        <span className="mt-1 block text-[11px] text-muted-foreground">{currentState}</span>
      </div>
      <span className={cn("h-fit border px-2 py-1 text-[11px] font-semibold", isHighPriority ? "border-amber-500/60 bg-amber-50 text-amber-800" : "border-border bg-muted/60 text-muted-foreground")}>{priority}</span>
    </div>
  ) : (
    <InfraTechnicalCard group={DOMAIN_GROUPS[action.domain_id.toLowerCase()] ?? "training"} className={cn("min-w-0", isHighPriority && "ring-1 ring-inset ring-[var(--room-accent)]/50")} dataSlot="training-advice-card" showEmblem={false}>
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-4" data-recommendation-card="full">
        <OperatorSlot
          slot={{
            name: action.operator || "未知干员",
            label: operatorName,
            portrait: operatorPortraitFor(action.operator, entry?.id),
            profession: operatorProfessionFor(action.operator),
          }}
          portraitSize={80}
          showSkillTooltip={showSkillTooltip}
          skillTooltipFocusable={showSkillTooltip && skillSummary.skills.length > 0}
          skillTooltipHighlightIds={skillSummary.highlightedSkillIds}
          skillTooltipContextLabel={skillSummary.highlightedSkillIds.length
            ? (intl("components_RecommendationCard.operatorBaseSkillsTargetHighlighted"))
            : (intl("components_RecommendationCard.operatorBaseSkills"))}
        />
        <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2 text-xs text-white/55"><span className="font-medium text-[var(--room-accent)]">{recommendationDomainLabel(action.domain_id, en)}</span><span aria-hidden="true">·</span><span>{recommendationKindLabel(action.kind, en)}</span></div><p className="font-number mt-2 max-w-[72ch] text-pretty text-sm leading-6 text-white/82">{message}</p></div>
          <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end"><span className={cn("font-number border px-2.5 py-1 text-xs font-semibold", isHighPriority ? "border-[var(--room-accent)] bg-[var(--room-accent)] text-[#202223]" : "border-[var(--room-accent)]/45 bg-black/18 text-[var(--room-accent)]")}>{priority}</span><span className="border border-white/15 bg-white/7 px-2.5 py-1 text-xs text-white/70">{currentState}</span></div>
        </div>
      </div>
    </InfraTechnicalCard>
  );
  return <motion.div initial={{ opacity: 0, y: reduceMotion ? 0 : 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : MOTION_DURATION.content, delay: reduceMotion ? 0 : Math.min(index, 5) * 0.035, ease: MOTION_EASE_OUT }}>{content}</motion.div>;
}
