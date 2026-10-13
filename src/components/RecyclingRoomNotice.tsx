"use client";
import { useTranslations } from "next-intl";

export function RecyclingRoomNotice({ editable = false }: { editable?: boolean }) {
  const t = useTranslations("RecyclingRoom");
  return <p className="mt-1 font-number text-[10px] leading-4 text-white/65" title={t("manualOnly")}>
    {t(editable ? "manualOnly" : "unconfigured")}
  </p>;
}
