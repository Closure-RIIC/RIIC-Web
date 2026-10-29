import type { AppLocale } from "@riic/contracts/locale";
import { operatorName } from "../i18n/game-data";
import { gameLabel } from "../i18n/game-labels";
import type { MessageTranslator } from "../i18n/types";
import { formatDuration } from "./step-engine.ts";
import type { StepLogMessage, StepProblem, StepRound } from "./step-types.ts";

const roundLabel = (round: StepRound, t: MessageTranslator) => round === "round1" ? t("StepMessages.round1") : t("StepMessages.round2");

export function stepLogText(message: StepLogMessage, locale: AppLocale, t: MessageTranslator): string {
  const room = "room" in message ? gameLabel(t, message.room) : "";
  const name = "name" in message ? operatorName(message.name, locale) : "";
  switch (message.kind) {
    case "start": return t("StepMessages.start", { hour: String(message.startHour).padStart(2, "0"), duration: formatDuration(message.duration), seconds: message.sampleSec });
    case "crew": {
      const names = message.names.map(name => operatorName(name, locale)).join(" / ") || t("StepMessages.empty");
      const shift = message.shiftHours ? t("StepMessages.shiftHours", { first: message.shiftHours[0], second: message.shiftHours[1] })
        : message.round === "round1" ? t("StepMessages.noRotation") : "";
      return t("StepMessages.crew", { room, shift, round: roundLabel(message.round, t), names });
    }
    case "boost": return t("StepMessages.boost", { room, name, amount: message.amount, before: message.before.toFixed(1), after: message.after.toFixed(1) });
    case "mood-zero": return t("StepMessages.moodZero", { room, name });
    case "mood-full": return t("StepMessages.moodFull", { room, name });
    case "switch": return t("StepMessages.switch", { room, from: roundLabel(message.from, t), to: roundLabel(message.to, t) });
    case "end": return t("StepMessages.end");
    case "pause": return t("StepMessages.pause");
  }
}

export function stepProblemText(problem: StepProblem, locale: AppLocale, t: MessageTranslator): string {
  switch (problem.kind) {
    case "invalid-hour": return t("StepMessages.invalidHour", { room: gameLabel(t, problem.room) });
    case "unknown-operator": return t("StepMessages.unknownOperator", { room: gameLabel(t, problem.room), shift: problem.shift, name: operatorName(problem.name, locale) });
    case "duplicate-operator": return t("StepMessages.duplicateOperator", { name: operatorName(problem.name, locale) });
  }
}
