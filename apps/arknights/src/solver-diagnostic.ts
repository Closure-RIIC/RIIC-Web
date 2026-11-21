import { localizedOperationError } from "./operation-error-presentation.ts";
import type { AppLocale } from "@riic/contracts/locale";
import { localize as localize_solver_diagnostic } from "./i18n/helpers/solver_diagnostic.ts";
import type { DisplayError } from "@riic/arknights-domain/types";

export interface SolverDiagnostic { title: string; suggestion: string }

/** 服务端返回的错误码自带通用标题；当 message 是具体原因时，标题优先用具体原因。 */
function specificMessage(error: DisplayError, en: AppLocale): string | null {
  const message = localizedOperationError(error.message, en).trim();
  if (!message) return null;
  // 和通用定义相同的文字说明没有额外信息，仍然用 guidance 标题。
  const generic = [
    localize_solver_diagnostic.text(en, "guidance3"),
    localize_solver_diagnostic.text(en, "guidance1"),
    localize_solver_diagnostic.text(en, "guidance21"),
  ];
  return generic.includes(message) ? null : message;
}

export function solverDiagnosticFor(error: DisplayError, en: AppLocale = "zh-CN"): SolverDiagnostic {
  const specific = specificMessage(error, en);

  if (error.code === "AIC-BOX-1101") return {
    title: specific ?? localize_solver_diagnostic.text(en, "guidance1"),
    suggestion: localize_solver_diagnostic.text(en, "guidance2"),
  };
  // 电力不足、周期非法这类由服务端算出的具体原因，标题直接用具体原因。
  if (error.code === "AIC-LAYOUT-1201") {
    // 电力与换班周期是两类不同问题，建议分别给出，避免一律提示“检查设施配方”。
    const fieldCode = error.fieldErrors?.[0]?.code;
    const suggestion = fieldCode === "insufficient_power"
      ? localize_solver_diagnostic.text(en, "guidanceInsufficientPower")
      : localize_solver_diagnostic.text(en, "guidance4");
    return {
      title: specific ?? localize_solver_diagnostic.text(en, "guidance3"),
      suggestion,
    };
  }
  if (error.code === "AIC-REQ-1001" && error.fieldErrors?.some((field) => field.code === "invalid_rotation_cycle")) {
    return {
      title: specific ?? localize_solver_diagnostic.text(en, "guidance21"),
      suggestion: localize_solver_diagnostic.text(en, "guidanceRotationCycle"),
    };
  }
  if (error.code === "AIC-PLAN-3002" || error.code === "AIC-RATE-6001") return { title: localize_solver_diagnostic.text(en, "guidance5"), suggestion: localize_solver_diagnostic.text(en, "guidance6") };
  if (error.code === "AIC-PLAN-3005") return { title: localize_solver_diagnostic.text(en, "guidance7"), suggestion: localize_solver_diagnostic.text(en, "guidance8") };
  if (error.code === "AIC-PLAN-3006") return { title: localize_solver_diagnostic.text(en, "guidance9"), suggestion: localize_solver_diagnostic.text(en, "guidance10") };
  if (error.code === "AIC-PLAN-3007") return { title: localize_solver_diagnostic.text(en, "guidance11"), suggestion: localize_solver_diagnostic.text(en, "guidance12") };
  if (error.code === "AIC-PLAN-3008") return { title: localize_solver_diagnostic.text(en, "guidance13"), suggestion: localize_solver_diagnostic.text(en, "guidance14") };
  if (error.code === "AIC-PLAN-3003") return { title: localize_solver_diagnostic.text(en, "guidance15"), suggestion: localize_solver_diagnostic.text(en, "guidance16") };
  if (["AIC-PLAN-3001", "AIC-PLAN-3004", "AIC-SYS-5000"].includes(error.code)) return { title: localize_solver_diagnostic.text(en, "guidance17"), suggestion: localize_solver_diagnostic.text(en, "guidance18") };
  if (error.code.startsWith("AIC-AUTH-")) return { title: localize_solver_diagnostic.text(en, "guidance19"), suggestion: localize_solver_diagnostic.text(en, "guidance20") };
  return {
    title: specific ?? localize_solver_diagnostic.text(en, "guidance21"),
    suggestion: error.retryable ? localize_solver_diagnostic.text(en, "guidance22") : localize_solver_diagnostic.text(en, "guidance23"),
  };
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
