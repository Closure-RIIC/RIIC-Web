import { localize as localize_components_training_advice_presentation } from "../../i18n/helpers/components_training_advice_presentation.ts";
import { messageRecord } from "../../i18n/translate.ts";
import type {
  TrainingAdviceAcquisitionKind,
  TrainingAdviceCombinationState,
  TrainingAdviceConditionEvaluation,
  TrainingAdviceMemberProgress,
  TrainingAdviceMemberRole,
  TrainingAdvicePriority,
  TrainingAdviceProduct,
  TrainingAdviceReason,
  TrainingAdviceState,
  TrainingAdviceTarget,
  TrainingCombination,
} from "@/types";

export function trainingProductLabel(product?: TrainingAdviceProduct, en = false): string {
  return product ? (messageRecord(en, "components_training_advice_presentation_labels"))[product] : (localize_components_training_advice_presentation.text(en, "general"));
}

export function trainingProductGroup(product?: TrainingAdviceProduct): string {
  return product === "trade" ? "trading" : "manufacture";
}

export function trainingScaleLabel(scale?: TrainingCombination["scale"], en = false): string {
  if (scale === "system") return localize_components_training_advice_presentation.text(en, "systemCombination");
  if (scale === "small") return localize_components_training_advice_presentation.text(en, "smallCombination");
  return scale ?? "—";
}

export function trainingFacilityLabel(facility: string, en = false): string {
  return (messageRecord(en, "components_training_advice_presentation_labels2"))[facility] ?? facility;
}

export function trainingCombinationStateLabel(state?: TrainingAdviceCombinationState, en = false): string {
  return state ? (messageRecord(en, "components_training_advice_presentation_labels3"))[state] : (localize_components_training_advice_presentation.text(en, "unknown"));
}

export function trainingLevelText(target?: TrainingAdviceTarget | TrainingAdviceState, en = false): string {
  if (!target) return "—";
  if ("kind" in target) {
    if (target.kind === "no_requirement") return localize_components_training_advice_presentation.text(en, "noAdditionalTraining");
    if (target.kind === "derive_from_skill_binding") return localize_components_training_advice_presentation.text(en, "useSkillUnlockRequirement");
    if (target.kind === "needs_review") return localize_components_training_advice_presentation.text(en, "targetNeedsReview");
  }
  if (typeof target.elite !== "number") return "—";
  return target.level ? `${localize_components_training_advice_presentation.text(en, "elite")}${target.elite} Lv${target.level}` : `${localize_components_training_advice_presentation.text(en, "elite")}${target.elite}`;
}

export function trainingMemberProgressLabel(progress?: TrainingAdviceMemberProgress, en = false): string {
  return progress ? (messageRecord(en, "components_training_advice_presentation_labels4"))[progress] : (localize_components_training_advice_presentation.text(en, "unknown"));
}

export function trainingMemberRoleLabel(role?: TrainingAdviceMemberRole, en = false): string {
  return role ? (messageRecord(en, "components_training_advice_presentation_labels5"))[role] : "—";
}

export function trainingPriorityLabel(priority?: TrainingAdvicePriority, en = false): string {
  return priority ? (messageRecord(en, "components_training_advice_presentation_labels6"))[priority] : (localize_components_training_advice_presentation.text(en, "basicGoal"));
}

export function trainingReasonLabel(reason?: TrainingAdviceReason, en = false): string {
  return reason ? (messageRecord(en, "components_training_advice_presentation_labels7"))[reason] : (localize_components_training_advice_presentation.text(en, "basicGoal"));
}

export function trainingAcquisitionLabel(kind: TrainingAdviceAcquisitionKind, en = false): string {
  return (messageRecord(en, "components_training_advice_presentation_labels8"))[kind];
}

export function trainingConditionStatusLabel(status: TrainingAdviceConditionEvaluation["status"], en = false): string {
  return (messageRecord(en, "components_training_advice_presentation_labels9"))[status];
}
