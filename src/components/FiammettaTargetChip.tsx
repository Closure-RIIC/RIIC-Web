"use client";
import { useTranslations, useLocale } from "use-intl";

import { HeartPulse } from "lucide-react";

import { localizedOperatorName } from "@/i18n/game-data";
import { useGameCatalog } from "@/i18n/game-data-client";

export interface FiammettaTargetChipProps {
  target?: string | null;
  portrait?: string | null;
  onClick?: () => void;
}

/** Shared morale-recovery target used beside schedule shift controls. */
export function FiammettaTargetChip({ target, portrait, onClick }: FiammettaTargetChipProps) {
  const intl = useTranslations();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();

  const displayTarget = target ? localizedOperatorName(target, locale, gameCatalog) : null;
  const label = displayTarget
    ? (intl("components_FiammettaTargetChip.moraleRecovery", { displayTarget: displayTarget }))
    : (intl("components_FiammettaTargetChip.chooseMoraleTarget"));
  const title = displayTarget
    ? (intl("components_FiammettaTargetChip.fiammettaRestores", { displayTarget: displayTarget }))
    : label;
  const className = "flex h-7 items-center gap-1 rounded-[min(var(--radius-md),12px)] border border-rose-500/30 bg-rose-500/10 px-2.5 text-[0.8rem] text-rose-700 shadow-xs max-sm:h-11";
  const content = (
    <>
      <span className="size-5 shrink-0 overflow-hidden rounded-full border border-rose-500/25 bg-rose-100">
        {portrait && displayTarget
          ? <img src={portrait} alt="" className="size-full object-cover" />
          : <HeartPulse className="m-1 size-3 text-rose-600" />}
      </span>
      {displayTarget ? (
        <span className="whitespace-nowrap"><span className="text-rose-700/80">{intl("components_FiammettaTargetChip.moraleRecovery2")}</span> {displayTarget}</span>
      ) : (
        <span className="whitespace-nowrap">{label}</span>
      )}
    </>
  );

  return onClick ? (
    <button
      type="button"
      className={`${className} cursor-pointer outline-none transition-colors hover:bg-rose-500/15 focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-1`}
      aria-label={label}
      title={title}
      data-fiammetta-target-chip
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <span className={className} title={title} data-fiammetta-target-chip>
      {content}
    </span>
  );
}
