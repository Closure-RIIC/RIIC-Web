import { AgentHistoryError } from "./message-history.ts";
import { AgentScheduleContext, parsePlanReferences } from "./schedule-context.ts";
import { getAgentPlanArtifact } from "./plan-artifact.ts";

export function restoreAgentScheduleContext(userId: string, conversationId: unknown, references: unknown) {
  if (typeof conversationId !== "string" || !/^[\w:-]{1,128}$/.test(conversationId)) throw new AgentHistoryError("缺少有效对话编号，请刷新后重试。");
  try { return new AgentScheduleContext(userId, conversationId, parsePlanReferences(references), getAgentPlanArtifact); }
  catch (error) { throw new AgentHistoryError("排班引用无效，请刷新后重试。", { cause: error }); }
}
