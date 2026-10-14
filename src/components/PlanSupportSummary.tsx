"use client";

import { useLocale } from "use-intl";
import { ChevronDown, HeartPulse } from "lucide-react";
import { PRODUCT_ICON_URLS } from "@/product-assets";
import { Switch } from "@/components/ui/switch";
import { localizedOperatorName, localizedRoomTitle } from "@/i18n/game-data";
import { useGameCatalog } from "@/i18n/game-data-client";
import type { MaaPlan } from "@/types";

export function PlanSupportSummary({ drones, target, portrait, automatic, onAutomaticChange, onChooseFacility, automaticDisabled = false }: {
  drones?: MaaPlan["drones"];
  target?: string | null;
  portrait?: string | null;
  automatic: boolean;
  onAutomaticChange?: (automatic: boolean) => void;
  onChooseFacility: () => void;
  /** Manual schedules keep the auto allocator unavailable while preserving their chosen target. */
  automaticDisabled?: boolean;
}) {
  const locale = useLocale();
  const en = locale === "en";
  const catalog = useGameCatalog();
  const validDrone = drones?.enable && Number.isInteger(drones.index) && drones.index > 0;
  const group = drones?.room === "trading" ? "trading" : "manufacture";
  const room = validDrone
    ? localizedRoomTitle(`${group === "trading" ? "贸易站" : "制造站"} ${drones.index}`, group, locale, catalog)
    : en ? "Not assigned" : "未分配";
  const operator = target ? localizedOperatorName(target, locale, catalog) : en ? "Not enabled" : "未启用";
  const cell = "relative min-h-[84px] min-w-0 border-r border-b border-[#313131]/10 px-3 py-3 max-sm:min-h-[78px] max-sm:border-t";
  const label = "block truncate pr-6 text-[10px] font-medium tracking-[0.06em] text-[#313131]/58";
  const value = "mt-1 flex min-w-0 items-center gap-1 text-[clamp(1rem,1.5vw,1.35rem)] font-semibold leading-none";
  const droneText = "truncate bg-linear-to-r from-violet-700 from-35% to-purple-300 bg-clip-text text-transparent";
  const moraleText = "truncate bg-linear-to-r from-red-600 from-35% to-pink-100 bg-clip-text text-transparent";

  return <>
    <div className={cell} data-plan-support="drones">
      <span className={label}>{en ? "Drones" : "无人机"}</span>
      <img src={PRODUCT_ICON_URLS.drone} alt="" width={32} height={32} loading="eager" className="pointer-events-none absolute right-1.5 top-1.5 size-8 object-contain opacity-75" aria-hidden="true" />
      {!automatic && (onAutomaticChange || automaticDisabled) ? (
        <button type="button" className={`${value} max-w-full text-purple-700 outline-none hover:underline focus-visible:underline max-sm:min-h-8`} aria-label={en ? "Choose facility" : "选择设施"} onClick={onChooseFacility}>
          <span className={droneText}>{room}</span><ChevronDown className="size-3 shrink-0" />
        </button>
      ) : <strong className={`${value} text-purple-700`}><span className={droneText}>{room}</span></strong>}
      {onAutomaticChange || automaticDisabled ? <label className={`mt-2 flex min-h-5 items-center gap-2 text-[10px] text-[#313131]/65 max-sm:min-h-11 ${automaticDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
        <Switch size="sm" className="data-checked:bg-purple-300 data-checked:border-purple-400/60 focus-visible:border-purple-400 focus-visible:ring-purple-400/40" checked={automatic} disabled={automaticDisabled} onCheckedChange={onAutomaticChange} />
        {en ? "Auto-assign drones" : "自动分配无人机"}
      </label> : null}
    </div>
    <div className={`${cell} border-r-0 max-sm:col-span-2`} data-plan-support="morale">
      <span className={label}>{en ? "Morale recovery" : "换心情"}</span>
      {portrait && target ? <img src={portrait} alt="" width={32} height={32} className="absolute right-1.5 top-1.5 size-8 rounded-full border border-rose-400/30 object-cover" /> : <HeartPulse className="absolute right-2 top-2 size-6 text-rose-400" aria-hidden="true" />}
      <strong className={`${value} text-rose-700`}><span className={moraleText}>{operator}</span></strong>
      <span className="mt-2 block text-[10px] text-[#313131]/50">{en ? "Current shift" : "当前班次"}</span>
    </div>
  </>;
}
