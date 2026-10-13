import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";

import { toPublicPlanData } from "../public-plan.ts";
import { getDatabase } from "../db/index.ts";
import { agentPlanArtifact } from "../db/schema.ts";
import type { MaaRoom } from "../../types.ts";

export interface AgentPlanShiftRoom {
  room: string;
  operators: string[];
}

export interface AgentPlanShift {
  shift: number;
  name: string;
  rooms: AgentPlanShiftRoom[];
}

export interface AgentPlanProjection {
  diagnosticId: string;
  durationMs: number;
  layoutLabel: string;
  operboxLabel: string;
  summary: Record<string, unknown>;
  dailyProduction: Record<string, unknown>;
  plans: AgentPlanShift[];
  trainingAdvice: {
    context: Record<string, unknown>;
    recommendations: unknown[];
    combinations: unknown[];
  } | null;
}

export interface AgentPlanMeta {
  layoutPreset: string;
  boxSource: string;
  factoryRecipes: string[];
  /** v2 起记录贸易站订单（gold=龙门商法 / originium=开采协力换合成玉）。 */
  tradeOrders?: string[];
  operatorCount: number;
}

export interface AgentPlanArtifactRecord {
  id: string;
  plan: AgentPlanProjection;
  /** v2 起附带完整工作台会话（求解结果 + 布局 + box），供工作台一键注入复用全部现有功能。 */
  session: AgentPlanSession | null;
  meta: AgentPlanMeta;
  createdAt: Date;
}

/** 与前端 PersistedSessionV5 等价的注入载荷。 */
export interface AgentPlanSession {
  presetLabel: string;
  layout: unknown;
  operbox: unknown;
  sourceName: string | null;
  boxSource: string;
  rotationProfile: string;
  fiammettaEnabled: boolean;
  result: unknown;
  activeShift: number;
}

interface StoredArtifactV1 {
  projection: AgentPlanProjection;
  meta: AgentPlanMeta;
}

interface StoredArtifactV2 extends StoredArtifactV1 {
  version: 2;
  session: AgentPlanSession;
}

const ARTIFACT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 求解器输出 → 供模型/结果页消费的精简投影（数值仍来自求解器，未改写）。 */
export function projectPlanResult(publicResult: ReturnType<typeof toPublicPlanData>): AgentPlanProjection {
  const { profile, maa, trainingAdvice, durationMs, diagnosticId } = publicResult;
  const plans: AgentPlanShift[] = maa.plans.map((plan, planIndex) => ({
    shift: planIndex + 1,
    name: plan.name,
    rooms: Object.entries(plan.rooms).flatMap(([roomType, roomList]) =>
      ((roomList ?? []) as MaaRoom[]).map((room, roomIndex) => ({
        room: `${roomType}${roomIndex + 1}`,
        operators: room.operators.map((operator) =>
          typeof operator === "string" ? operator : operator?.name ?? "（空）"
        ),
      }))
    ),
  }));
  return {
    diagnosticId,
    durationMs,
    layoutLabel: profile.layout_label,
    operboxLabel: profile.operbox_label,
    summary: profile.summary as unknown as Record<string, unknown>,
    dailyProduction: profile.rotation as unknown as Record<string, unknown>,
    plans,
    trainingAdvice: trainingAdvice
      ? {
          context: trainingAdvice.context as unknown as Record<string, unknown>,
          recommendations: trainingAdvice.recommendations.slice(0, 8),
          combinations: trainingAdvice.combinations.slice(0, 8),
        }
      : null,
  };
}

export async function saveAgentPlanArtifact(
  userId: string,
  plan: AgentPlanProjection,
  meta: AgentPlanMeta,
  session: AgentPlanSession
): Promise<string> {
  const db = getDatabase();
  const id = randomUUID();
  const now = new Date();
  await db.insert(agentPlanArtifact).values({
    id,
    userId,
    plan: { version: 2, projection: plan, session, meta } satisfies StoredArtifactV2,
    meta,
    createdAt: now,
    expiresAt: new Date(now.getTime() + ARTIFACT_TTL_MS),
  });
  // Best-effort cleanup of expired artifacts for this user.
  await db.delete(agentPlanArtifact).where(lt(agentPlanArtifact.expiresAt, now)).catch(() => undefined);
  return id;
}

export async function getAgentPlanArtifact(id: string, userId: string): Promise<AgentPlanArtifactRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = getDatabase();
  const rows = await db
    .select()
    .from(agentPlanArtifact)
    .where(and(eq(agentPlanArtifact.id, id), eq(agentPlanArtifact.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.delete(agentPlanArtifact).where(eq(agentPlanArtifact.id, id)).catch(() => undefined);
    return null;
  }
  const stored = row.plan as unknown;
  let projection: AgentPlanProjection;
  let session: AgentPlanSession | null = null;
  if (stored && typeof stored === "object" && "projection" in stored) {
    const typed = stored as StoredArtifactV2;
    projection = typed.projection;
    session = typed.session ?? null;
  } else {
    projection = stored as AgentPlanProjection;
  }
  return {
    id: row.id,
    plan: projection,
    session,
    meta: row.meta as AgentPlanMeta,
    createdAt: row.createdAt,
  };
}
