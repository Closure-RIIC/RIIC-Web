import { manualRoomCapacity, type ManualScheduleDraft } from "./manual-schedule.ts";
import { manualEditableRooms, type EditableRoom } from "./recycling-room.ts";
import type { BaseBlueprint } from "@riic/arknights-domain/types";

const labels: Record<EditableRoom["kind"], string> = {
  control_center: "中枢", trade_post: "贸易站", factory: "制造站", power_plant: "发电站",
  dormitory: "宿舍", office: "办公室", meeting_room: "会客室", workshop: "加工站",
  training_room: "训练室", recycling: "回收站",
};
export function scheduleTextRoomLabel(room: EditableRoom, layout: BaseBlueprint): string {
  const numbered = ["trade_post", "factory", "power_plant", "dormitory"].includes(room.kind);
  return labels[room.kind] + (numbered ? layout.rooms.filter(r => r.kind === room.kind).findIndex(r => r.id === room.id) + 1 : "");
}
const compact = (value: string) => value.replace(/\s/g, "");
const productLabel = (room: EditableRoom, assignment: ManualScheduleDraft["shifts"][number]["rooms"][string]) => {
  const product = assignment?.product ?? (room.kind === "recycling" ? undefined : room.product);
  if (product && "trade" in product) return product.trade.order === "gold" ? "龙门币" : "合成玉";
  if (product && "factory" in product) return { gold: "赤金", battle_record: "作战记录", originium: "源石碎片", all: "待定配方" }[product.factory.recipe];
  return "";
};

/** A reversible text view of the shared draft. Unmentioned rows are retained when applying a patch. */
export function scheduleDraftToText(layout: BaseBlueprint, draft: ManualScheduleDraft): string {
  const rooms = manualEditableRooms(layout);
  const lines = rooms.map(room => `${scheduleTextRoomLabel(room, layout)}：` + draft.shifts.map(shift => {
    const assignment = shift.rooms[room.id];
    const names = [...(assignment?.operators ?? [])];
    while (names.length && !names.at(-1)) names.pop();
    const team = names.length ? names.map(name => name ?? "_").join("、") : "-";
    const efficiency = ["trade_post", "factory", "power_plant"].includes(room.kind)
      ? ` @${assignment?.manualSkillEfficiencyPct === undefined ? "自动" : `${assignment.manualSkillEfficiencyPct}%`}` : "";
    const product = productLabel(room, assignment);
    return team + efficiency + (product ? ` #${product}` : "");
  }).join(" | "));
  lines.push("无人机：" + draft.shifts.map(shift => rooms.find(r => r.id === shift.droneTargetRoomId)).map(room => room ? scheduleTextRoomLabel(room, layout) : "-").join(" | "));
  lines.push("菲亚梅塔：" + draft.shifts.map(shift => draft.fiammettaEnabled ? shift.fiammettaTarget ?? "-" : "-").join(" | "));
  return lines.join("\n");
}

export type ScheduleTextResult = { draft: ManualScheduleDraft; changedRows: number; errors: string[] };
export function applyScheduleText(text: string, layout: BaseBlueprint, draft: ManualScheduleDraft, knownNames: ReadonlySet<string>): ScheduleTextResult {
  if (text.length > 64 * 1024) return { draft, changedRows: 0, errors: ["批量文本不能超过 64 KB。"] };
  const next = structuredClone(draft);
  const errors: string[] = [];
  const rooms = manualEditableRooms(layout);
  const roomMap = new Map(rooms.flatMap(room => [[compact(scheduleTextRoomLabel(room, layout)), room], [room.id, room]] as const));
  const seen = new Map<string, number>();
  const rowLines = new Map<string, number>();
  let changedRows = 0;
  for (const [lineIndex, raw] of text.split(/\r?\n/).entries()) {
    const lineNumber = lineIndex + 1;
    const fail = (message: string) => errors.push(`第 ${lineNumber} 行：${message}`);
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    const match = line.match(/^([^:：]+)[:：](.*)$/);
    if (!match) { fail("请使用“设施：第1班 | 第2班 …”格式。"); continue; }
    const label = compact(match[1]!);
    const room = roomMap.get(label);
    const id = room?.id ?? label;
    if (!room && !["无人机", "菲亚梅塔"].includes(label)) { fail(`当前布局没有“${label}”。`); continue; }
    if (seen.has(id)) { fail(`与第 ${seen.get(id)} 行重复。`); continue; }
    seen.set(id, lineNumber);
    rowLines.set(id, lineNumber);
    const cells = match[2]!.split(/[|｜]/).map(cell => cell.trim());
    if (cells.length !== draft.shifts.length) { fail(`需要 ${draft.shifts.length} 个班次，当前有 ${cells.length} 列。`); continue; }
    for (let index = 0; index < cells.length; index++) {
      if (cells[index] === "=") {
        if (!index) { fail("第一班不能用 =。"); continue; }
        cells[index] = cells[index - 1]!;
      }
      const cell = cells[index]!;
      const shift = next.shifts[index]!;
      if (label === "无人机") {
        const target = cell === "-" ? undefined : roomMap.get(compact(cell));
        if (cell !== "-" && (!target || !["trade_post", "factory"].includes(target.kind))) fail(`${index + 1} 班的无人机去向必须是贸易站、制造站或 -。`);
        else shift.droneTargetRoomId = target?.id ?? null;
        continue;
      }
      if (label === "菲亚梅塔") {
        if (cell !== "-" && (!knownNames.has(cell) || cell === "菲亚梅塔")) fail(`${index + 1} 班的菲亚梅塔对象“${cell}”无效。`);
        else shift.fiammettaTarget = cell === "-" ? null : cell;
        continue;
      }
      if (!room) continue;
      const parsed = cell.match(/^([^@#]*?)(?:@\s*(自动|auto|\d+(?:\.\d+)?)\s*[%％]?)?\s*(?:#\s*(\S+))?$/);
      if (!parsed) { fail(`${index + 1} 班格式错误；使用“干员、干员 @90% #龙门币”。`); continue; }
      const team = parsed[1]!.trim();
      if (!team) { fail(`${index + 1} 班为空；清空请写 -。`); continue; }
      const names = team === "-" ? [] : team.split(/[、,，]/).map(name => name.trim()).map(name => ["_", "空位"].includes(name) ? null : name);
      if (names.length > manualRoomCapacity(room)) fail(`${scheduleTextRoomLabel(room, layout)}最多 ${manualRoomCapacity(room)} 位，第 ${index + 1} 班填写了 ${names.length} 位。`);
      for (const name of names) if (name !== null && !knownNames.has(name)) fail(`${index + 1} 班未知干员“${name}”。请使用图鉴全名。`);
      const assignment = { ...shift.rooms[room.id], operators: names };
      if (parsed[2] && !["trade_post", "factory", "power_plant"].includes(room.kind)) fail("只有贸易、制造、发电设施可以填写效率。");
      if (parsed[2] && !["自动", "auto"].includes(parsed[2])) {
        const efficiency = Number(parsed[2]);
        if (efficiency > 10000) fail("技能效率应在 0%～10000% 之间。");
        assignment.manualSkillEfficiencyPct = efficiency;
      } else delete assignment.manualSkillEfficiencyPct;
      const product = parsed[3];
      if (product) {
        if (room.kind === "trade_post" && ["龙门币", "合成玉"].includes(product)) {
          if (product === "合成玉" && room.level < 3) fail("合成玉需要 3 级贸易站，请在 Box 与排班设置中调整等级。");
          assignment.product = { trade: { order: product === "龙门币" ? "gold" : "originium" } };
        } else if (room.kind === "factory" && ["赤金", "作战记录", "源石碎片", "待定配方"].includes(product)) {
          if (product === "源石碎片" && !layout.rooms.some(r => r.kind === "factory" && r.level >= 3)) fail("源石碎片需要至少一间 3 级制造站解锁。");
          assignment.product = { factory: { recipe: ({ 赤金: "gold", 作战记录: "battle_record", 源石碎片: "originium", 待定配方: "all" } as const)[product as "赤金"] } };
        } else fail(`${index + 1} 班的产物“${product}”不适用于此设施。`);
      }
      shift.rooms[room.id] = assignment;
    }
    changedRows++;
  }
  if (!changedRows && !errors.length) errors.push("请至少填写一行设施或支援安排。");
  if (seen.has("菲亚梅塔")) next.fiammettaEnabled = next.shifts.some(shift => Boolean(shift.fiammettaTarget));
  const external = new Set(next.externalOperatorNames);
  for (const [index, shift] of next.shifts.entries()) {
    const assigned = new Map<string, string>();
    for (const room of rooms) for (const name of shift.rooms[room.id]?.operators ?? []) {
      if (!name) continue;
      const previous = assigned.get(name);
      if (previous) errors.push(`第 ${rowLines.get(room.id) ?? rowLines.get(previous) ?? "未编辑"} 行：第 ${index + 1} 班的 ${name} 同时出现在 ${scheduleTextRoomLabel(roomMap.get(previous)!, layout)} 和 ${scheduleTextRoomLabel(room, layout)}。`);
      assigned.set(name, room.id);
      external.add(name);
    }
    if (shift.fiammettaTarget && !assigned.has(shift.fiammettaTarget)) errors.push(`第 ${rowLines.get("菲亚梅塔") ?? "未编辑"} 行：第 ${index + 1} 班的菲亚梅塔对象 ${shift.fiammettaTarget} 未安排入驻。`);
  }
  next.externalOperatorNames = [...external];
  return { draft: errors.length ? draft : next, changedRows, errors };
}
