import { z } from "zod";
import { createManualScheduleDraft, manualRoomCapacity, reconcileManualScheduleDraft, type ManualScheduleDraft } from "./manual-schedule.ts";
import { manualEditableRooms } from "./recycling-room.ts";
import { validateLayoutJson } from "@riic/arknights-domain/layout-validation";
import type { BaseBlueprint, OperBoxEntry } from "@riic/arknights-domain/types";

export { POSTER_STORAGE_KEY, POSTER_HANDOFF_KEY } from "./schedule-poster-storage.ts";
export const POSTER_MAX_BYTES = 256 * 1024;
const text = (max: number) => z.string().max(max);
const product = z.union([
  z.object({ trade: z.object({ order: z.enum(["gold", "originium"]) }) }),
  z.object({ factory: z.object({ recipe: z.enum(["all", "gold", "battle_record", "originium"]) }) }),
]);
const assignment = z.object({
  operators: z.array(text(80).nullable()).max(5),
  product: product.optional(), autofill: z.boolean().optional(),
  autofillSlots: z.array(z.number().int().min(0).max(4)).max(5).optional(),
  manualSkillEfficiencyPct: z.number().finite().min(0).max(10000).optional(),
});
const schema = z.object({
  format: z.literal("riic-schedule-poster"), version: z.literal(1),
  meta: z.object({ title: text(40), author: text(40), instructions: text(240), notes: text(120) }),
  efficiencyMode: z.enum(["native", "manual"]),
  layout: z.object({
    template: text(40), drone_cap: z.number().int().min(0).max(1000),
    scenario: z.object({
      elite_facility_count: z.number().min(0).max(30).optional(),
      sui_facility_count: z.number().min(0).max(30).optional(),
      dorm_occupant_count: z.number().min(0).max(20).optional(),
      base_workforce: z.array(text(80)).max(200).optional(),
      initial_global: z.object({ monster_cuisine: z.number().min(0).max(100).optional() }).optional(),
    }),
    rooms: z.array(z.object({ id: text(60), kind: z.enum(["control_center", "trade_post", "factory", "power_plant", "dormitory", "office", "meeting_room", "workshop", "training_room"]), level: z.number().int().min(1).max(5), product: product.optional(), dorm_beds: z.number().int().min(1).max(5).optional() })).min(1).max(25),
  }),
  draft: z.object({
    version: z.literal(3), scheduleMode: z.enum(["sequential", "period"]),
    externalOperatorNames: z.array(text(80)).max(200), startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).or(z.literal("")),
    activeShift: z.number().int().min(0).max(3), fiammettaEnabled: z.boolean(),
    shifts: z.array(z.object({
      durationHours: z.number().positive().max(24), rooms: z.record(text(60), assignment),
      fiammettaTarget: text(80).nullable(), droneTargetRoomId: text(60).nullable(),
    })).min(1).max(4),
  }),
  operators: z.array(z.object({ id: text(80), name: text(80), elite: z.number().int().min(0).max(2), level: z.number().int().min(1).max(90), own: z.boolean(), potential: z.number().int().min(1).max(6), rarity: z.number().int().min(1).max(6) })).max(200),
  presentation: z.object({
    hiddenFacilities: z.array(text(60)).max(25),
    backgroundColor: z.string().regex(/^#[\da-fA-F]{6}$/),
    showInstructions: z.boolean().default(true),
    dormHangerOperators: z.array(text(80).nullable()).max(4).default([]),
  }),
});

export interface SchedulePosterDocument {
  format: "riic-schedule-poster";
  version: 1;
  meta: { title: string; author: string; instructions: string; notes: string };
  efficiencyMode: "native" | "manual";
  layout: BaseBlueprint;
  draft: ManualScheduleDraft;
  operators: OperBoxEntry[];
  presentation: { hiddenFacilities: string[]; backgroundColor: string; showInstructions: boolean; dormHangerOperators: (string | null)[] };
}

/** Files contain editable data only. Portraits, background images and computed results are not embedded. */
export function parsePosterDocument(value: unknown): SchedulePosterDocument {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`作业文件格式不正确：${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  const doc = parsed.data;
  const errors = validateLayoutJson(doc.layout);
  const rooms = manualEditableRooms(doc.layout);
  if (doc.layout.rooms.filter(room => room.kind === "trade_post" || room.kind === "factory").length > 7) errors.push("单页最多支持 7 个生产设施。");
  if (doc.layout.rooms.filter(room => room.kind === "power_plant").length > 3) errors.push("最多支持 3 个发电站。");
  for (const [index, shift] of doc.draft.shifts.entries()) {
    const used = new Set<string>();
    for (const [id, assignment] of Object.entries(shift.rooms)) {
      const room = rooms.find(room => room.id === id);
      if (!room) { errors.push(`未知设施 ${id}`); continue; }
      if (assignment.operators.length > manualRoomCapacity(room)) errors.push(`${id} 人数超过容量。`);
      if (new Set(assignment.autofillSlots ?? []).size !== (assignment.autofillSlots ?? []).length) errors.push(`${id} 的 AUTO 槽位重复。`);
      if (assignment.autofillSlots?.length && ["training_room", "recycling"].includes(room.kind)) errors.push(`${id} 不支持 MAA 自动填充。`);
      for (const slotIndex of assignment.autofillSlots ?? []) {
        if (slotIndex >= manualRoomCapacity(room)) errors.push(`${id} 的 AUTO 槽位超过设施容量。`);
        if (assignment.operators[slotIndex]) errors.push(`${id} 的 AUTO 槽位不能同时安排固定干员。`);
      }
      if (assignment.autofillSlots?.length && assignment.autofill === false) errors.push(`${id} 设置了 AUTO 槽位但关闭了设施自动填充。`);
      for (const name of assignment.operators.filter(Boolean)) {
        if (used.has(name!)) errors.push(`第 ${index + 1} 班的 ${name} 重复入驻。`);
        used.add(name!);
      }
      const p = assignment.product;
      if (p && !(room.kind === "trade_post" && "trade" in p || room.kind === "factory" && "factory" in p)) errors.push(`${id} 产物类型不符。`);
      if (p && "trade" in p && p.trade.order === "originium" && room.level < 3) errors.push(`${id} 合成玉需要 3 级贸易站。`);
      if (p && "factory" in p && p.factory.recipe === "originium" && !doc.layout.rooms.some(room => room.kind === "factory" && room.level >= 3)) errors.push(`${id} 源石碎片需要 3 级制造站解锁。`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return doc;
}

export function readPosterFile(content: string): SchedulePosterDocument {
  if (new TextEncoder().encode(content).length > POSTER_MAX_BYTES) throw new Error("作业文件不能超过 256 KB。");
  return parsePosterDocument(JSON.parse(content));
}

export function createPosterDocument(layout: BaseBlueprint, draft = createManualScheduleDraft([8, 8, 8]), operators: readonly OperBoxEntry[] = []): SchedulePosterDocument {
  const used = new Set(draft.shifts.flatMap(shift => Object.values(shift.rooms).flatMap(room => room.operators).concat(shift.fiammettaTarget)));
  if (draft.fiammettaEnabled) used.add("菲亚梅塔");
  return {
    format: "riic-schedule-poster", version: 1,
    meta: { title: `${layout.template} ${draft.shifts.length}班轮换`, author: "", instructions: "", notes: "" },
    layout: structuredClone(layout), draft: structuredClone(draft), operators: structuredClone(operators.filter(operator => used.has(operator.name))),
    efficiencyMode: "native", presentation: { hiddenFacilities: [], backgroundColor: "#eff0ec", showInstructions: true, dormHangerOperators: Array.from({ length: draft.shifts.length }, () => null) },
  };
}

export function posterDataOnly(doc: SchedulePosterDocument): SchedulePosterDocument {
  const used = new Set(doc.draft.shifts.flatMap(shift => Object.values(shift.rooms).flatMap(room => room.operators).concat(shift.fiammettaTarget)).concat(doc.presentation.dormHangerOperators));
  if (doc.draft.fiammettaEnabled) used.add("菲亚梅塔");
  return parsePosterDocument({ ...doc, operators: doc.operators.filter(operator => used.has(operator.name)) });
}

/** Retain the site's complete dorm assignments; the poster chooses which occupants to show. */
export function posterDraftForManual(doc: SchedulePosterDocument): ManualScheduleDraft {
  const draft = structuredClone(doc.draft);
  draft.externalOperatorNames = [...new Set(draft.shifts.flatMap(shift => Object.values(shift.rooms).flatMap(room => room.operators.filter((name): name is string => Boolean(name)))))];
  return reconcileManualScheduleDraft(draft, doc.layout);
}
