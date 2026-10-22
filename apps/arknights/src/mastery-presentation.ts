import { localize as localize_mastery_presentation } from "./i18n/helpers/mastery_presentation.ts";
import { formatMasteryTime, type MasteryPlan } from "./mastery.ts";

export type MasteryInstruction = { elapsed: number; text: string; kind: "start" | "switch" | "complete" | "notice" };
/** Shared by the visible timeline and clipboard so execution instructions cannot drift. */
export function masteryInstructions(plan: MasteryPlan, en = false, operatorName: (name: string) => string = (name) => name): MasteryInstruction[][] {
  let elapsed = 0;
  return plan.stages.map((stage) => {
    const rows: MasteryInstruction[] = [];
    const first = stage.segments[0]!;
    const firstName = first.trainerId ? operatorName(first.trainerName) : (localize_mastery_presentation.text(en, "noTrainer"));
    if (stage.discardPreviousHalving) rows.push({ elapsed, kind: "notice", text: localize_mastery_presentation.text(en, "removeThePreviousTrainerBeforeStartingDiscardTheSaved") });
    if (stage.activateWith) {
      rows.push({ elapsed, kind: "start", text: localize_mastery_presentation.text(en, "startMWithToApplyThe50Reduction", { level: stage.level, value2: operatorName(stage.activateWith.name) }) });
      if (stage.activateWith.id !== first.trainerId) rows.push({ elapsed, kind: "switch", text: localize_mastery_presentation.text(en, "thenImmediatelySwitchTo", { firstName: firstName }) });
    } else rows.push({ elapsed, kind: "start", text: localize_mastery_presentation.text(en, "startMWith", { level: stage.level, firstName: firstName }) });
    stage.segments.forEach((segment, index) => {
      const name = segment.trainerId ? operatorName(segment.trainerName) : (localize_mastery_presentation.text(en, "noTrainer"));
      if (index) rows.push({ elapsed, kind: "switch", text: localize_mastery_presentation.text(en, "switchTo", { name: name }) });
      rows.push({ elapsed, kind: "notice", text: localize_mastery_presentation.text(en, "trainForAtTotalSpeed", { name: name, value2: formatMasteryTime(segment.seconds), value3: (segment.rate * 100).toFixed(0) }) });
      elapsed += segment.seconds;
    });
    rows.push({ elapsed, kind: "complete", text: localize_mastery_presentation.text(en, "completeM", { level: stage.level }) });
    if (stage.nextHalvingTrainerId) rows.push({ elapsed, kind: "notice", text: localize_mastery_presentation.text(en, "keepBothOperatorsInTheTrainingRoomStartThe") });
    return rows;
  });
}

export function masteryClipboard(plan: MasteryPlan, targetName: string, en = false, operatorName?: (name: string) => string): string {
  return [
    `${targetName} · ${localize_mastery_presentation.text(en, "additional1", { choice1: ((en)) && (plan.mode === "simple") ? "yes" : "no", choice2: (!(en)) && (plan.mode === "simple") ? "yes" : "no" })} · ${formatMasteryTime(plan.totalSeconds)}`,
    ...masteryInstructions(plan,en,operatorName).flat().map((step) => `[+${formatMasteryTime(step.elapsed)}] ${step.text}`),
  ].join("\n");
}
