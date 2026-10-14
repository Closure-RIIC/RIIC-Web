"use client";
import { useTranslations, useLocale } from "use-intl";

import { motion, useReducedMotion } from "motion/react";
import { Ban } from "lucide-react";

import { OperatorSlot } from "@/components";
import { InfraTechnicalCard } from "@/components/InfraTechnicalCard";
import { Button } from "@/components/ui/button";
import { MOTION_DURATION, MOTION_EASE_OUT } from "@/motion";
import { operatorPortraitFor, operatorProfessionFor } from "@/operatorPortraits";
import type {
  OperBoxEntry,
  TrainingNewbieItem,
  TrainingRecommendation,
} from "@/types";
import { localizedOperatorName } from "@/i18n/game-data";
import { useGameCatalog } from "@/i18n/game-data-client";

import {
  trainingAcquisitionLabel,
  trainingConditionStatusLabel,
  trainingLevelText,
  trainingPriorityLabel,
  trainingProductGroup,
  trainingProductLabel,
  trainingReasonLabel,
} from "./presentation";
import { trainingAdviceSkillSummary } from "./skill-selection";

type ActionCardItem = TrainingNewbieItem | TrainingRecommendation;

export function TrainingAdviceActionCard({
  action,
  entry,
  index,
  blacklisted = false,
  onToggleBlacklist,
}: {
  action: ActionCardItem;
  entry?: OperBoxEntry;
  index: number;
  blacklisted?: boolean;
  onToggleBlacklist?: () => void;
}) {
  const intl = useTranslations();
  const reduceMotion = useReducedMotion();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const en = locale === "en";
  const actionLabel = action.action === "acquire" || action.action === "train" ? intl(`components_training_advice_TrainingAdviceActionCard.${action.action}`) : action.action;
  const currentText = action.current ? `${intl("components_training_advice_TrainingAdviceActionCard.current")} ${trainingLevelText(action.current, en)} → ` : "";
  const targetText = trainingLevelText(action.target, en);
  const operatorName = localizedOperatorName(action.operator, locale, gameCatalog);
  const skillSummary = trainingAdviceSkillSummary(action.operator, action.current, action.target);

  return (
    <motion.div
      initial={{ opacity: 0, y: reduceMotion ? 0 : 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reduceMotion ? 0 : MOTION_DURATION.content,
        delay: reduceMotion ? 0 : Math.min(index, 5) * 0.035,
        ease: MOTION_EASE_OUT,
      }}
    >
      <InfraTechnicalCard
        group={trainingProductGroup(action.product)}
        dataSlot="training-advice-card"
        showEmblem={false}
      >
        <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
          <OperatorSlot
            slot={{
              name: action.operator,
              label: action.operator,
              portrait: operatorPortraitFor(action.operator, entry?.id),
              profession: operatorProfessionFor(action.operator),
            }}
            portraitSize={80}
            showSkillTooltip
            skillTooltipFocusable={skillSummary.skills.length > 0}
            skillTooltipHighlightIds={skillSummary.highlightedSkillIds}
            skillTooltipContextLabel={skillSummary.highlightedSkillIds.length
              ? (intl("components_training_advice_TrainingAdviceActionCard.operatorSkillsTargetSkillHighlighted"))
              : (intl("components_training_advice_TrainingAdviceActionCard.operatorInfrastructureSkills"))}
          />
          <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-white/55">
                <span className="font-medium text-[var(--room-accent)]">
                  {trainingProductLabel(action.product, en)}
                </span>
                {"combination_name" in action && action.combination_name ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{action.combination_name}</span>
                  </>
                ) : null}
              </div>
              <p className="mt-2 max-w-[72ch] text-pretty text-sm leading-6 text-white/82">
                {actionLabel} {en ? operatorName : `「${operatorName}」`} · {currentText}{intl("components_training_advice_TrainingAdviceActionCard.target")} {targetText}
              </p>
              {action.acquisition ? (
                <p className="mt-1 text-xs leading-5 text-white/58">
                  {intl("components_training_advice_TrainingAdviceActionCard.acquisition")}：{trainingAcquisitionLabel(action.acquisition.kind, en)} · {action.acquisition.detail}
                </p>
              ) : null}
              {"efficiency" in action && action.efficiency ? (
                <p className="mt-1 text-xs leading-5 text-white/58">
                  {intl("components_training_advice_TrainingAdviceActionCard.efficiencyInsight")}：{action.efficiency.value}%
                  {action.efficiency.note ? ` · ${action.efficiency.note}` : ""}
                </p>
              ) : null}
              {"conditions" in action && action.conditions?.length ? (
                <ul className="mt-2 grid gap-1 text-xs leading-5 text-white/58">
                  {action.conditions.map(({ condition, status }) => (
                    <li key={`${condition.kind}-${condition.key}`}>
                      {trainingConditionStatusLabel(status, en)} · {condition.description}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex flex-col items-center gap-2">
                <span className="font-number border border-[var(--room-accent)] bg-[var(--room-accent)] px-2.5 py-1 text-xs font-semibold text-[#202223]">
                  {trainingPriorityLabel("priority" in action ? action.priority : undefined, en)}
                </span>
                {"reason" in action && action.reason ? (
                  <span className="border border-white/15 bg-white/7 px-2.5 py-1 text-xs text-white/70">
                    {trainingReasonLabel(action.reason, en)}
                  </span>
                ) : null}
              </div>
              {onToggleBlacklist ? <Button type="button" size="icon-sm" variant="ghost" onClick={onToggleBlacklist} aria-label={en ? `${blacklisted ? "Unblock" : "Block"} ${operatorName}` : `${blacklisted ? "取消拉黑" : "拉黑"}${operatorName}`} title={en ? (blacklisted ? "Unblock operator" : "Hide this operator") : (blacklisted ? "取消拉黑" : "拉黑此干员")} className="size-8 border border-white/15 bg-black/20 text-white/60 hover:bg-white/10 hover:text-white"><Ban className="size-4" /></Button> : null}
            </div>
          </div>
        </div>
      </InfraTechnicalCard>
    </motion.div>
  );
}
