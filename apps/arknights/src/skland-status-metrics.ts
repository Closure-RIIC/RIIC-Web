import { localize as localize_skland_status_metrics } from "./i18n/helpers/skland_status_metrics.ts";
import type {
  SklandInfrastructureRoom,
  SklandManufactureRoom,
  SklandStatusSnapshot,
  SklandTradingOrder,
  SklandTradingRoom,
} from "./types.ts";

export type SklandMetricTone = "blue" | "green" | "amber" | "orange";
export type SklandMetricVisual = "rest" | "trading" | "manufacture" | "clue";

export interface SklandStatusMetric {
  id: string;
  label: string;
  value: string;
  total: string | null;
  hint: string;
  tone: SklandMetricTone;
  visual: SklandMetricVisual;
}

export function sklandTradingOrderRewardLabel(
  order: SklandTradingOrder,
  en = false
): "合成玉" | "龙门币" | "Orundum" | "LMD" {
  const isOrundum = order.reward.type === "orundum"
    || order.delivery.some((item) => item.type === "originium_shard");
  if (en) return isOrundum ? "Orundum" : "LMD";
  return isOrundum ? "合成玉" : "龙门币";
}

export function formatDashboardDuration(seconds: number, en = false): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  if (safe <= 0) return localize_skland_status_metrics.text(en, "complete");
  if (safe < 60) return localize_skland_status_metrics.text(en, "under1Minute");
  const days = Math.floor(safe / 86_400);
  const hours = Math.floor((safe % 86_400) / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  if (days > 0) return localize_skland_status_metrics.text(en, "dH", { days: days, hours: hours });
  if (hours > 0) return localize_skland_status_metrics.text(en, "hM", { hours: hours, minutes: minutes });
  return localize_skland_status_metrics.text(en, "m", { value1: Math.max(1, minutes) });
}

function until(timestamp: number | null | undefined, now: number, fallback: string, en = false): string {
  if (!timestamp || timestamp <= 0) return fallback;
  return formatDashboardDuration(timestamp - now, en);
}

function sumProduction(
  rooms: SklandInfrastructureRoom[],
  group: "trading" | "manufacture"
): { current: number; total: number | null } {
  const matching = rooms.filter((room): room is SklandTradingRoom | SklandManufactureRoom => room.group === group);
  if (group === "trading") {
    return {
      current: matching.reduce((total, room) => total + (room.production.stock ?? 0), 0),
      total: matching.reduce((total, room) => total + (room.production.capacity ?? 0), 0),
    };
  }
  const knownCapacities = matching.flatMap((room) => (
    room.production.unitCapacity === null ? [] : [room.production.unitCapacity]
  ));
  return {
    current: matching.reduce((total, room) => total + (room.production.completed ?? 0), 0),
    total: knownCapacities.length === matching.length
      ? knownCapacities.reduce((total, capacity) => total + capacity, 0)
      : null,
  };
}

function fractionMetric(
  id: string,
  label: string,
  current: number,
  total: number | null,
  hint: string,
  tone: SklandMetricTone,
  visual: SklandMetricVisual
): SklandStatusMetric {
  return { id, label, value: String(current), total: total === null ? "—" : String(total), hint, tone, visual };
}

export function deriveSklandBuildingMetrics(snapshot: SklandStatusSnapshot, now: number, en = false): SklandStatusMetric[] {
  const { infrastructure } = snapshot;
  const trading = sumProduction(infrastructure.rooms, "trading");
  const manufacture = sumProduction(infrastructure.rooms, "manufacture");
  const dormOperators = infrastructure.rooms
    .filter((room) => room.group === "dormitory")
    .flatMap((room) => room.operators);
  const restedOperators = dormOperators.filter((operator) => operator.morale >= 24).length;
  const meeting = infrastructure.rooms.find((room) => room.group === "meeting");
  const clueCount = meeting?.group === "meeting" ? meeting.clue.board.length : 0;
  const sharingClues = meeting?.group === "meeting" && meeting.clue.sharing;

  return [
    fractionMetric(
      "rest",
      localize_skland_status_metrics.text(en, "restProgress"),
      restedOperators,
      dormOperators.length,
      dormOperators.length
        ? localize_skland_status_metrics.text(en, "operatorsAreStillResting", { value1: dormOperators.length - restedOperators })
        : localize_skland_status_metrics.text(en, "noOperatorsAreResting"),
      "green",
      "rest"
    ),
    fractionMetric("trading", localize_skland_status_metrics.text(en, "orderProgress"), trading.current, trading.total, localize_skland_status_metrics.text(en, "tradingPostOrderStock"), "blue", "trading"),
    fractionMetric(
      "manufacture",
      localize_skland_status_metrics.text(en, "manufacturingProgress"),
      manufacture.current,
      manufacture.total,
      manufacture.total === null ? (localize_skland_status_metrics.text(en, "capacityIsUnknownForSomeFormulas")) : (localize_skland_status_metrics.text(en, "completedFactoryProducts")),
      "amber",
      "manufacture"
    ),
    {
      id: "clue",
      label: localize_skland_status_metrics.text(en, "clueCollection"),
      value: sharingClues ? (localize_skland_status_metrics.text(en, "sharing")) : String(clueCount),
      total: sharingClues ? null : "7",
      hint: sharingClues
        ? localize_skland_status_metrics.text(en, "sharingEndsIn", { value1: (en) ? (until(meeting?.group === "meeting" ? meeting.clue.shareCompleteTime : null, now, "progress", true)) : "", value2: (en) ? "" : (until(meeting?.group === "meeting" ? meeting.clue.shareCompleteTime : null, now, "交流进行中")) })
        : meeting
          ? localize_skland_status_metrics.text(en, "cluesPlaced", { clueCount: clueCount })
          : localize_skland_status_metrics.text(en, "receptionRoomDataNotProvided"),
      tone: "orange",
      visual: "clue",
    },
  ];
}
