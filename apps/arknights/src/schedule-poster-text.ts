import type { AppLocale } from "@riic/contracts/locale";
import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
import type Messages from "../messages/zh-CN/PosterTextErrors.json";
const errorText = createLocalizer<typeof Messages>("PosterTextErrors");
import { manualRoomCapacity, type ManualRoomAssignment, type ManualScheduleDraft } from "./manual-schedule.ts";
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
const automaticEfficiencyTokens = new Set(["自动", "效率自动", "auto-efficiency"]);
const supportsMaaAutofill = (room: EditableRoom) => !["training_room", "recycling"].includes(room.kind);
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
    const names = assignment?.operators ?? [];
    const autoSlots = new Set(assignment?.autofillSlots ?? []);
    if (supportsMaaAutofill(room) && assignment?.autofill === true && !autoSlots.size) {
      const firstEmptySlot = Array.from({ length: manualRoomCapacity(room) }, (_, index) => names[index]).findIndex(name => !name);
      if (firstEmptySlot >= 0) autoSlots.add(firstEmptySlot);
    }
    const lastSlot = Math.max(
      names.reduce((last, name, index) => name ? index : last, -1),
      ...autoSlots,
    );
    const team = lastSlot < 0
      ? supportsMaaAutofill(room) && assignment?.autofill !== false ? "auto" : "-"
      : Array.from({ length: lastSlot + 1 }, (_, index) => (
        autoSlots.has(index) ? "auto" : names[index] ?? "_"
      )).join("、");
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
export function applyScheduleText(text: string, layout: BaseBlueprint, draft: ManualScheduleDraft, knownNames: ReadonlySet<string>, locale: AppLocale = "zh-CN"): ScheduleTextResult {
  if (text.length > 64 * 1024) return { draft, changedRows: 0, errors: [errorText.text(locale, "tooLarge")] };
  const next = structuredClone(draft);
  const errors: string[] = [];
  const rooms = manualEditableRooms(layout);
  const roomMap = new Map(rooms.flatMap(room => [[compact(scheduleTextRoomLabel(room, layout)), room], [room.id, room]] as const));
  const seen = new Map<string, number>();
  const rowLines = new Map<string, number>();
  let changedRows = 0;
  for (const [lineIndex, raw] of text.split(/\r?\n/).entries()) {
    const lineNumber = lineIndex + 1;
    const fail = (message: string) => errors.push(errorText.text(locale, "line", { line: lineNumber, message }));
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    const match = line.match(/^([^:：]+)[:：](.*)$/);
    if (!match) { fail(errorText.text(locale, "format")); continue; }
    const label = compact(match[1]!);
    const room = roomMap.get(label);
    const id = room?.id ?? label;
    if (!room && !["无人机", "菲亚梅塔"].includes(label)) { fail(errorText.text(locale, "missingRoom", { label })); continue; }
    if (seen.has(id)) { fail(errorText.text(locale, "duplicate", { line: seen.get(id)! })); continue; }
    seen.set(id, lineNumber);
    rowLines.set(id, lineNumber);
    const cells = match[2]!.split(/[|｜]/).map(cell => cell.trim());
    if (cells.length !== draft.shifts.length) { fail(errorText.text(locale, "shiftCount", { count: draft.shifts.length, actual: cells.length })); continue; }
    for (let index = 0; index < cells.length; index++) {
      if (cells[index] === "=") {
        if (!index) { fail(errorText.text(locale, "firstEquals")); continue; }
        cells[index] = cells[index - 1]!;
      }
      const cell = cells[index]!;
      const shift = next.shifts[index]!;
      if (label === "无人机") {
        const target = cell === "-" ? undefined : roomMap.get(compact(cell));
        if (cell !== "-" && (!target || !["trade_post", "factory"].includes(target.kind))) fail(errorText.text(locale, "droneTarget", { shift: index + 1 }));
        else shift.droneTargetRoomId = target?.id ?? null;
        continue;
      }
      if (label === "菲亚梅塔") {
        if (cell !== "-" && (!knownNames.has(cell) || cell === "菲亚梅塔")) fail(errorText.text(locale, "fiammettaTarget", { shift: index + 1, target: cell }));
        else shift.fiammettaTarget = cell === "-" ? null : cell;
        continue;
      }
      if (!room) continue;
      const productMatch = cell.match(/\s+#\s*(\S+)\s*$/);
      const withoutProduct = productMatch ? cell.slice(0, productMatch.index).trimEnd() : cell;
      if (withoutProduct.includes("#")) { fail(errorText.text(locale, "productFormat", { shift: index + 1 })); continue; }
      const atIndex = withoutProduct.indexOf("@");
      const team = (atIndex < 0 ? withoutProduct : withoutProduct.slice(0, atIndex)).trim();
      if (!team) { fail(errorText.text(locale, "emptyShift", { shift: index + 1 })); continue; }
      const directives = atIndex < 0 ? [] : withoutProduct.slice(atIndex + 1).split("@").map(value => value.trim());
      if (directives.some(value => !value)) { fail(errorText.text(locale, "directiveFormat", { shift: index + 1 })); continue; }
      let efficiencyMode: number | "automatic" | undefined;
      let invalidDirective = false;
      for (const directive of directives) {
        const token = directive.replace(/\s*[%％]\s*$/, "").trim();
        const lowerToken = token.toLowerCase();
        if (automaticEfficiencyTokens.has(lowerToken)) {
          if (efficiencyMode !== undefined) { fail(errorText.text(locale, "duplicateEfficiency", { shift: index + 1 })); invalidDirective = true; break; }
          efficiencyMode = "automatic";
        } else if (/^\d+(?:\.\d+)?$/.test(token)) {
          if (efficiencyMode !== undefined) { fail(errorText.text(locale, "duplicateEfficiency", { shift: index + 1 })); invalidDirective = true; break; }
          efficiencyMode = Number(token);
        } else {
          fail(errorText.text(locale, "unknownDirective", { shift: index + 1, directive }));
          invalidDirective = true;
          break;
        }
      }
      if (invalidDirective) continue;
      const memberTokens = team === "-" ? [] : team.split(/[、,，]/).map(name => name.trim());
      const autoToken = (name: string) => ["auto", "free"].includes(name.toLowerCase());
      const autofillSlots = memberTokens.flatMap((name, slotIndex) => autoToken(name) ? [slotIndex] : []);
      const names = memberTokens.map(name => ["_", "空位"].includes(name) || autoToken(name) ? null : name);
      if (names.length > manualRoomCapacity(room)) fail(errorText.text(locale, "capacity", { room: scheduleTextRoomLabel(room, layout), capacity: manualRoomCapacity(room), shift: index + 1, actual: names.length }));
      for (const name of names) if (name !== null && !knownNames.has(name)) fail(errorText.text(locale, "unknownOperator", { shift: index + 1, name }));
      const assignment: ManualRoomAssignment = { ...shift.rooms[room.id], operators: names };
      if (autofillSlots.length && !supportsMaaAutofill(room)) fail(errorText.text(locale, "autofill"));
      if (supportsMaaAutofill(room)) assignment.autofill = autofillSlots.length > 0;
      else delete assignment.autofill;
      if (autofillSlots.length) {
        assignment.autofillSlots = autofillSlots;
      } else {
        delete assignment.autofillSlots;
      }
      if (["trade_post", "factory", "power_plant"].includes(room.kind)) {
        if (efficiencyMode === undefined || efficiencyMode === "automatic") delete assignment.manualSkillEfficiencyPct;
        else if (!Number.isFinite(efficiencyMode) || efficiencyMode > 10000) fail(errorText.text(locale, "efficiencyRange"));
        else assignment.manualSkillEfficiencyPct = efficiencyMode;
      } else if (efficiencyMode !== undefined) {
        fail(errorText.text(locale, "efficiencyRoom"));
      }
      const product = productMatch?.[1];
      if (product) {
        if (room.kind === "trade_post" && ["龙门币", "合成玉"].includes(product)) {
          if (product === "合成玉" && room.level < 3) fail(errorText.text(locale, "tradeLevel"));
          assignment.product = { trade: { order: product === "龙门币" ? "gold" : "originium" } };
        } else if (room.kind === "factory" && ["赤金", "作战记录", "源石碎片", "待定配方"].includes(product)) {
          if (product === "源石碎片" && !layout.rooms.some(r => r.kind === "factory" && r.level >= 3)) fail(errorText.text(locale, "factoryLevel"));
          assignment.product = { factory: { recipe: ({ 赤金: "gold", 作战记录: "battle_record", 源石碎片: "originium", 待定配方: "all" } as const)[product as "赤金"] } };
        } else fail(errorText.text(locale, "invalidProduct", { shift: index + 1, product }));
      }
      shift.rooms[room.id] = assignment;
    }
    changedRows++;
  }
  if (!changedRows && !errors.length) errors.push(errorText.text(locale, "empty"));
  if (seen.has("菲亚梅塔")) next.fiammettaEnabled = next.shifts.some(shift => Boolean(shift.fiammettaTarget));
  const external = new Set(next.externalOperatorNames);
  for (const [index, shift] of next.shifts.entries()) {
    const assigned = new Map<string, string>();
    for (const room of rooms) for (const name of shift.rooms[room.id]?.operators ?? []) {
      if (!name) continue;
      const previous = assigned.get(name);
      if (previous) errors.push(errorText.text(locale, "conflict", { line: rowLines.get(room.id) ?? rowLines.get(previous) ?? errorText.text(locale, "unedited"), shift: index + 1, name, first: scheduleTextRoomLabel(roomMap.get(previous)!, layout), second: scheduleTextRoomLabel(room, layout) }));
      assigned.set(name, room.id);
      external.add(name);
    }
    if (shift.fiammettaTarget && !assigned.has(shift.fiammettaTarget)) errors.push(errorText.text(locale, "targetNotAssigned", { line: rowLines.get("菲亚梅塔") ?? errorText.text(locale, "unedited"), shift: index + 1, name: shift.fiammettaTarget }));
  }
  next.externalOperatorNames = [...external];
  return { draft: errors.length ? draft : next, changedRows, errors };
}
