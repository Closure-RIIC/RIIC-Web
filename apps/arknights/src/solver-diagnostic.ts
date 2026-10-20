import { localize as localize_solver_diagnostic } from "./i18n/helpers/solver_diagnostic.ts";
import type { DisplayError } from "./types.ts";

export interface SolverDiagnostic { title: string; suggestion: string }

export function solverDiagnosticFor(error: DisplayError, en = false): SolverDiagnostic {
  if (en) {
    if (error.code === "AIC-BOX-1101") return { title: "Operator data needs attention", suggestion: "Import the BOX again and confirm the file uses a supported export format." };
    if (error.code === "AIC-LAYOUT-1201") return { title: "Base configuration conflict", suggestion: "Check facility levels, production recipes, and power supply." };
    if (error.code === "AIC-PLAN-3002" || error.code === "AIC-RATE-6001") return { title: "Request not admitted yet", suggestion: "Wait for the countdown before retrying. Do not submit repeatedly." };
    if (error.code === "AIC-PLAN-3005") return { title: "A task is already queued", suggestion: "Wait for the current task to finish before submitting another schedule." };
    if (error.code === "AIC-PLAN-3006") return { title: "This account is submitting too frequently", suggestion: "Wait for the countdown, then submit again for this account." };
    if (error.code === "AIC-PLAN-3007") return { title: "This network is submitting too frequently", suggestion: "Other users may be active on this network. Wait for the countdown before trying again." };
    if (error.code === "AIC-PLAN-3008") return { title: "The candidate ring is full", suggestion: "Retry after a candidate slot is released. Do not submit repeatedly." };
    if (error.code === "AIC-PLAN-3003") return { title: "Calculation timed out", suggestion: "Try again later. If it persists, copy the diagnostic information when reporting it." };
    if (["AIC-PLAN-3001", "AIC-PLAN-3004", "AIC-SYS-5000"].includes(error.code)) return { title: "Scheduling service unavailable", suggestion: "Try again. If it still fails, copy the diagnostic information for the maintainers." };
    if (error.code.startsWith("AIC-AUTH-")) return { title: "Account status needs attention", suggestion: "Sign in again or refresh account status before generating a schedule." };
    return { title: "Request could not be completed", suggestion: error.retryable ? "Try again later and keep the diagnostic number." : "Correct the input according to the error and try again." };
  }
  if (error.code === "AIC-BOX-1101") return { title: "干员数据需要处理", suggestion: "重新导入 BOX，并确认文件来自受支持的导出格式。" };
  if (error.code === "AIC-LAYOUT-1201") return { title: "基建配置存在冲突", suggestion: "检查设施等级、产物配方和供电是否有效。" };
  if (error.code === "AIC-PLAN-3002" || error.code === "AIC-RATE-6001") return { title: "请求暂未获准", suggestion: "请按页面倒计时等待后重试，无需连续点击生成。" };
  if (error.code === "AIC-PLAN-3005") return { title: "已有任务在排队", suggestion: "请等待当前任务完成后，再提交新的排班。" };
  if (error.code === "AIC-PLAN-3006") return { title: "账号提交过于频繁", suggestion: "请按页面倒计时等待；倒计时结束后再为当前账号提交。" };
  if (error.code === "AIC-PLAN-3007") return { title: "当前网络提交过于频繁", suggestion: "同一网络下可能有较多请求，请按页面倒计时等待后再试。" };
  if (error.code === "AIC-PLAN-3008") return { title: "候选环暂时已满", suggestion: "候选名额释放后即可重试，请勿连续提交。" };
  if (error.code === "AIC-PLAN-3003") return { title: "本次计算超时", suggestion: "稍后重试；持续出现时请复制诊断信息反馈。" };
  if (["AIC-PLAN-3001", "AIC-PLAN-3004", "AIC-SYS-5000"].includes(error.code)) return { title: "排班服务暂时异常", suggestion: "可以重试；若仍失败，请复制诊断信息交给维护者。" };
  if (error.code.startsWith("AIC-AUTH-")) return { title: "账号状态需要处理", suggestion: "重新登录或刷新账号状态后再生成排班。" };
  return { title: "请求未能完成", suggestion: error.retryable ? "请稍后重试，并保留诊断编号。" : "请按错误提示修正输入后重试。" };
}

export function formatSolverDiagnostic(error: DisplayError, en = false) {
  const diagnostic = solverDiagnosticFor(error, en);
  return [
    diagnostic.title,
    error.message,
    `${localize_solver_diagnostic.text(en, "errorCode")}：${error.code}`,
    ...(error.requestId ? [`${localize_solver_diagnostic.text(en, "requestId")}：${error.requestId}`] : []),
    ...(error.retryAfterSeconds ? [`${localize_solver_diagnostic.text(en, "suggestedWait")}：${error.retryAfterSeconds} ${localize_solver_diagnostic.text(en, "seconds")}`] : []),
    `${localize_solver_diagnostic.text(en, "suggestion")}：${diagnostic.suggestion}`,
  ].join("\n");
}
