import type { PlayerInfo } from "skland-kit";

import { buildBlueprint, PRESETS } from "@/blueprint";
import type { BaseBlueprint, SklandInfrastructure } from "@/types";

import { factoryProduct, manufacturesInGameOrder } from "./normalize";

export function sklandLayoutSuggestion(info: PlayerInfo): {
  layoutLabel: SklandInfrastructure["layoutLabel"];
  layoutSuggestion: BaseBlueprint | null;
  layoutWarning: string | null;
} {
  const building = info.building;
  const preset = PRESETS.find(
    (item) =>
      item.trading === building.tradings.length
      && item.manufacture === building.manufactures.length
      && item.power === building.powers.length
  );
  if (!preset) {
    return {
      layoutLabel: null,
      layoutSuggestion: null,
      layoutWarning: `森空岛布局为 ${building.tradings.length} 贸易 / ${building.manufactures.length} 制造 / ${building.powers.length} 发电，当前预设暂不支持。`,
    };
  }

  const layout = buildBlueprint(preset);
  const manufactures = manufacturesInGameOrder(building.manufactures);
  const groups = {
    trade_post: building.tradings,
    factory: manufactures,
    power_plant: building.powers,
    dormitory: building.dormitories,
  };
  const counters = new Map<string, number>();
  layout.rooms = layout.rooms.map((existing) => {
    if (existing.kind === "control_center") return { ...existing, level: building.control.level };
    if (existing.kind === "meeting_room" && building.meeting) return { ...existing, level: building.meeting.level };
    if (existing.kind === "office" && building.hire) return { ...existing, level: building.hire.level };
    if (existing.kind === "training_room" && building.training) return { ...existing, level: building.training.level };
    if (!(existing.kind in groups)) return existing;
    const index = counters.get(existing.kind) ?? 0;
    counters.set(existing.kind, index + 1);
    if (existing.kind === "trade_post") {
      const source = building.tradings[index];
      if (!source) return existing;
      return {
        ...existing,
        level: source.level,
        product: { trade: { order: source.strategy === "O_DIAMOND" ? "originium" : "gold" } },
      };
    }
    if (existing.kind === "factory") {
      const source = manufactures[index];
      if (!source) return existing;
      const recipe = factoryProduct(info, source.formulaId);
      return recipe === "unknown"
        ? { ...existing, level: source.level }
        : { ...existing, level: source.level, product: { factory: { recipe } } };
    }
    const source = groups[existing.kind as "power_plant" | "dormitory"][index];
    return source ? { ...existing, level: source.level } : existing;
  });

  return { layoutLabel: preset.label, layoutSuggestion: layout, layoutWarning: null };
}
