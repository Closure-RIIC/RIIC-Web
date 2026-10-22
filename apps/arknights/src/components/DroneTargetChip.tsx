"use client";

import { useLocale, useTranslations } from "use-intl";

import { localizedRoomTitle } from "@/i18n/game-data";
import { useGameCatalog } from "@/i18n/game-data-client";
import type { MaaPlan } from "@riic/arknights-domain/types";
import { DroneIcon } from "@/components/DroneIcon";

export function DroneTargetChip({ drones }: { drones?: MaaPlan["drones"] }) {
  const intl = useTranslations("components");
  const locale = useLocale();
  const catalog = useGameCatalog();
  if (!drones?.enable || !Number.isInteger(drones.index) || drones.index < 1) return null;
  const group = drones.room === "trading" ? "trading" : "manufacture";
  const fallback = drones.room === "trading" ? "贸易站" : "制造站";
  const room = localizedRoomTitle(`${fallback} ${drones.index}`, group, locale, catalog);
  const label = intl("droneTarget", { room });
  return (
    <span className="flex h-7 items-center gap-1 rounded-[min(var(--radius-md),12px)] border border-purple-700/30 bg-purple-700/10 px-2.5 text-[0.8rem] text-purple-700 max-sm:h-11" title={label} data-drone-target-chip>
      <DroneIcon className="size-4 shrink-0" />
      <span className="whitespace-nowrap">{label}</span>
    </span>
  );
}
