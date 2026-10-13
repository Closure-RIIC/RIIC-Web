"use client";
import { useTranslations } from "next-intl";
import { InfraTechnicalCard } from "@/components/InfraTechnicalCard";
import { OperatorSlot } from "@/components";

/** Unknown upstream data is distinct from a known empty room. */
export function RecyclingRoomPlaceholder() {
  const t = useTranslations("RecyclingRoom");
  return <InfraTechnicalCard group="recycling" className="min-w-0 px-3 py-2" dataSlot="recycling-data-unavailable">
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
      <div className="min-w-0">
        <h4 className="flex h-7 items-center gap-1.5 whitespace-nowrap text-sm font-medium">
          <span className="h-5 w-1 bg-[var(--room-accent)]" aria-hidden="true" />{t("title")}
        </h4>
        <p className="mt-1 text-[10px] leading-4 text-white/65">{t("noUpstreamData")}</p>
      </div>
      <div className="flex items-start gap-2" aria-label={t("unknownSlots")}>
        {[0, 1].map((index) => <OperatorSlot key={index} slot={undefined} compactView emptyLabel={t("unknown")} />)}
      </div>
    </div>
  </InfraTechnicalCard>;
}
