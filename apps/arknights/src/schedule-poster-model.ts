import type { AppLocale } from "@riic/contracts/locale";
import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
import type PosterLabels from "../messages/zh-CN/PosterLabels.json";
const posterText = createLocalizer<typeof PosterLabels>("PosterLabels");
import { PRESETS, roomKindLabel } from "@riic/arknights-domain/blueprint";
import { createManualScheduleDraft, manualRoomCapacity, manualRoomForShift, reconcileManualScheduleDraft } from "./manual-schedule";
import { posterOperators } from "./schedule-poster-operators";
import { PRODUCT_ICON_URLS } from "./product-assets";
import { manualEditableRooms, type EditableRoom } from "./recycling-room";
import { createPosterDocument, type SchedulePosterDocument } from "./schedule-poster-document";
import sampleTeams from "./schedule-poster-sample.json";
import type { BaseBlueprint } from "@riic/arknights-domain/types";

export { defaultPosterOperator, posterOperators } from "./schedule-poster-operators";

export const ROOM_GROUP: Record<EditableRoom["kind"], string> = { control_center: "control", factory: "manufacture", trade_post: "trading", power_plant: "power", dormitory: "dormitory", office: "hire", meeting_room: "meeting", workshop: "processing", training_room: "training", recycling: "recycling" };
export function posterRoomTitle(room: EditableRoom, layout: BaseBlueprint, locale?: AppLocale): string {
  if (locale) {
    const title = posterText.text(locale, room.kind);
    return ["trade_post", "factory", "power_plant"].includes(room.kind) ? `${title} ${layout.rooms.filter(r => r.kind === room.kind).findIndex(r => r.id === room.id) + 1}` : title;
  }
  if (room.kind === "recycling") return "回收站";
  if (room.kind === "dormitory") return "宿舍 · 挂件";
  if (room.kind === "office") return "人力";
  const title = roomKindLabel(room.kind);
  return ["trade_post", "factory", "power_plant"].includes(room.kind)
    ? `${title} ${layout.rooms.filter(r => r.kind === room.kind).findIndex(r => r.id === room.id) + 1}` : title;
}
export function posterProduct(doc: SchedulePosterDocument, room: EditableRoom, index: number, locale?: AppLocale) {
  if (room.kind === "recycling") return null;
  const effective = manualRoomForShift(room, doc.draft.shifts[index]?.rooms[room.id]);
  if (effective.product && "trade" in effective.product) return effective.product.trade.order === "gold"
    ? { value: "gold", label: locale ? posterText.text(locale, "lmd") : "龙门币", icon: PRODUCT_ICON_URLS.lmdOrders }
    : { value: "originium", label: locale ? posterText.text(locale, "orundum") : "合成玉", icon: PRODUCT_ICON_URLS.orundum };
  if (effective.product && "factory" in effective.product) {
    const recipe = effective.product.factory.recipe;
    return { value: recipe, label: locale ? posterText.text(locale, recipe) : { gold: "赤金", battle_record: "作战记录", originium: "源石碎片", all: "待定配方" }[recipe], icon: { gold: PRODUCT_ICON_URLS.gold, battle_record: PRODUCT_ICON_URLS.experience, originium: PRODUCT_ICON_URLS.shards, all: PRODUCT_ICON_URLS.gold }[recipe] };
  }
  return null;
}
export function createPosterSample(template = "252", count = 3): SchedulePosterDocument {
  const layout = structuredClone(PRESETS.find(preset => preset.label === template)?.layout ?? PRESETS[0]!.layout);
  const draft = createManualScheduleDraft(Array.from({ length: count }, () => 24 / count), "08:00", "period");
  const teams = sampleTeams as Record<string, string[][]>;
  for (const [index, shift] of draft.shifts.entries()) {
    for (const room of manualEditableRooms(layout)) {
      const key = room.kind === "dormitory" ? room.id === "dorm_1" ? "dorm_support" : "" : room.kind === "power_plant" ? "power" : room.id;
      let members = teams[key]?.[index % 3] ?? [];
      if (room.kind === "power_plant") members = members.slice(Number(room.id.split("_").pop()) - 1, Number(room.id.split("_").pop()));
      shift.rooms[room.id] = { operators: members.slice(0, manualRoomCapacity(room)), ...(room.kind === "dormitory" ? { autofill: false } : {}) };
    }
  }
  const doc = createPosterDocument(layout, reconcileManualScheduleDraft(draft, layout));
  doc.meta = { title: `${template} ${["", "", "两", "三", "四"][count]}班轮换`, author: "排版示例", instructions: "按各站班次顺序换班；休息人员由手动排班管理，图中仅展示宿舍挂件。", notes: "示例组合用于演示排版，练度默认最高精英化；请按实际练度调整。" };
  doc.operators = posterOperators(doc);
  return doc;
}

/** Legacy generated titles remain canonical in stored/exported documents. */
export function posterDisplayTitle(doc: SchedulePosterDocument, locale: AppLocale): string {
  return /^\d{3} [一二两三四1234]班轮换$/.test(doc.meta.title)
    ? posterText.text(locale, "defaultTitle", { layout: doc.layout.template, count: doc.draft.shifts.length })
    : doc.meta.title;
}
