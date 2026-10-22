// 浏览器临时交接：广播只更新待载入横幅；跨页 storage 仅一次性使用，读取即删除。
import type { AgentPlanSession } from "./server/agent/plan-artifact";

export const AGENT_BROADCAST_CHANNEL = "riic-agent";
const HANDOFF_STORAGE_KEY = "riic-agent-artifact-handoff";
const HANDOFF_TTL_MS = 5 * 60 * 1000;

export interface AgentArtifactHandoff {
  preset: string;
  session: AgentPlanSession;
}

export function isAgentArtifactHandoff(value: unknown): value is AgentArtifactHandoff {
  if (!value || typeof value !== "object") return false;
  const { preset, session } = value as AgentArtifactHandoff;
  return typeof preset === "string" && !!session && typeof session === "object"
    && typeof session.presetLabel === "string" && !!session.layout && typeof session.layout === "object"
    && Array.isArray((session.layout as { rooms?: unknown }).rooms) && Array.isArray(session.operbox)
    && !!session.result && typeof session.result === "object"
    && !!(session.result as { maa?: unknown }).maa
    && Array.isArray((session.result as { maa: { plans?: unknown } }).maa.plans);
}

export function agentArtifactFromOutput(output: unknown): AgentArtifactHandoff | null {
  if (!output || typeof output !== "object") return null;
  const record = output as { workbenchSession?: AgentPlanSession };
  const handoff = { preset: record.workbenchSession?.presetLabel, session: record.workbenchSession };
  return isAgentArtifactHandoff(handoff) ? handoff : null;
}

export function receiveAgentArtifactMessage(value: unknown, onReady: (handoff: AgentArtifactHandoff) => void): void {
  if (value && typeof value === "object" && (value as { type?: unknown }).type === "plan-ready" && isAgentArtifactHandoff(value)) {
    onReady(value);
  }
}

export function requestAgentArtifactOpen(handoff: AgentArtifactHandoff): void {
  if (typeof window === "undefined") return;
  if (!isAgentArtifactHandoff(handoff)) throw new Error("排班数据不完整，请重新求解后打开。");
  try {
    window.sessionStorage.setItem(HANDOFF_STORAGE_KEY, JSON.stringify({ ...handoff, expiresAt: Date.now() + HANDOFF_TTL_MS }));
  } catch {
    throw new Error("临时交接失败（浏览器存储不可用或空间不足），请留在此页重试，或在已打开的工作台点击新结果提示。");
  }
  try {
    window.location.assign("/");
  } catch {
    window.sessionStorage.removeItem(HANDOFF_STORAGE_KEY);
    throw new Error("工作台跳转失败，请在此页重试。");
  }
}

export function consumeAgentArtifactHandoff(): AgentArtifactHandoff | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(HANDOFF_STORAGE_KEY);
  if (!raw) return null;
  window.sessionStorage.removeItem(HANDOFF_STORAGE_KEY);
  const parsed: unknown = JSON.parse(raw);
  if (!isAgentArtifactHandoff(parsed) || typeof (parsed as { expiresAt?: unknown }).expiresAt !== "number"
    || (parsed as AgentArtifactHandoff & { expiresAt: number }).expiresAt <= Date.now()) {
    throw new Error("临时排班交接已过期或不完整，请返回助理重新打开。");
  }
  return parsed;
}
