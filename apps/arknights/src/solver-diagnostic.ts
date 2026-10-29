import { localizedOperationError } from "./operation-error-presentation.ts";
import type { AppLocale } from "@riic/contracts/locale";
import { localize as localize_solver_diagnostic } from "./i18n/helpers/solver_diagnostic.ts";
import type { DisplayError } from "@riic/arknights-domain/types";

export interface SolverDiagnostic { title: string; suggestion: string }

export function solverDiagnosticFor(error: DisplayError, en: AppLocale = "zh-CN"): SolverDiagnostic {

  if (error.code === "AIC-BOX-1101") return { title: localize_solver_diagnostic.text(en, "guidance1"), suggestion: localize_solver_diagnostic.text(en, "guidance2") };
  if (error.code === "AIC-LAYOUT-1201") return { title: localize_solver_diagnostic.text(en, "guidance3"), suggestion: localize_solver_diagnostic.text(en, "guidance4") };
  if (error.code === "AIC-PLAN-3002" || error.code === "AIC-RATE-6001") return { title: localize_solver_diagnostic.text(en, "guidance5"), suggestion: localize_solver_diagnostic.text(en, "guidance6") };
  if (error.code === "AIC-PLAN-3005") return { title: localize_solver_diagnostic.text(en, "guidance7"), suggestion: localize_solver_diagnostic.text(en, "guidance8") };
  if (error.code === "AIC-PLAN-3006") return { title: localize_solver_diagnostic.text(en, "guidance9"), suggestion: localize_solver_diagnostic.text(en, "guidance10") };
  if (error.code === "AIC-PLAN-3007") return { title: localize_solver_diagnostic.text(en, "guidance11"), suggestion: localize_solver_diagnostic.text(en, "guidance12") };
  if (error.code === "AIC-PLAN-3008") return { title: localize_solver_diagnostic.text(en, "guidance13"), suggestion: localize_solver_diagnostic.text(en, "guidance14") };
  if (error.code === "AIC-PLAN-3003") return { title: localize_solver_diagnostic.text(en, "guidance15"), suggestion: localize_solver_diagnostic.text(en, "guidance16") };
  if (["AIC-PLAN-3001", "AIC-PLAN-3004", "AIC-SYS-5000"].includes(error.code)) return { title: localize_solver_diagnostic.text(en, "guidance17"), suggestion: localize_solver_diagnostic.text(en, "guidance18") };
  if (error.code.startsWith("AIC-AUTH-")) return { title: localize_solver_diagnostic.text(en, "guidance19"), suggestion: localize_solver_diagnostic.text(en, "guidance20") };
  return { title: localize_solver_diagnostic.text(en, "guidance21"), suggestion: error.retryable ? localize_solver_diagnostic.text(en, "guidance22") : localize_solver_diagnostic.text(en, "guidance23") };
}

export function formatSolverDiagnostic(error: DisplayError, en: AppLocale = "zh-CN") {
  const diagnostic = solverDiagnosticFor(error, en);
  return [
    diagnostic.title,
    localizedOperationError(error.message, en),
    `${localize_solver_diagnostic.text(en, "errorCode")}：${error.code}`,
    ...(error.requestId ? [`${localize_solver_diagnostic.text(en, "requestId")}：${error.requestId}`] : []),
    ...(error.retryAfterSeconds ? [`${localize_solver_diagnostic.text(en, "suggestedWait")}：${error.retryAfterSeconds} ${localize_solver_diagnostic.text(en, "seconds")}`] : []),
    `${localize_solver_diagnostic.text(en, "suggestion")}：${diagnostic.suggestion}`,
  ].join("\n");
}
