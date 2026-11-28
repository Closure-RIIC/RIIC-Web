"use client";
import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
import { useLocale } from "use-intl";
import type AdminMessages from "../../../../messages/zh-CN/Admin_billing_console.json";

const adminText = createLocalizer<typeof AdminMessages>("Admin_billing_console");

export type AgentModelEntry = {
  provider: string;
  model: string;
  order: number;
  role: "primary" | "secondary" | "reserve" | "vision";
  rateConfigured: boolean;
  routeConfigured: boolean | null;
  observedAt: string | null;
};

export function AgentModelDirectory({ models }: { models: AgentModelEntry[] }) {
  const locale = useLocale();
  const roleLabel = { primary: "primaryModel", secondary: "secondaryModel", reserve: "reserveModel", vision: "visionModel" } as const;
  return <section className="space-y-3 rounded-xl border bg-card p-4">
    <div><h2 className="font-semibold">{adminText.text(locale, "modelRequestOrder")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{adminText.text(locale, "modelRequestOrderHint")}</p></div>
    {models.length ? <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{[...models].sort((a, b) => a.order - b.order).map(entry => {
      const observed = entry.observedAt ? new Date(entry.observedAt) : null;
      return <li key={`${entry.provider}/${entry.model}`} className="min-w-0 space-y-2 rounded-lg border p-3">
        <p className="text-sm font-medium">{entry.order}. {adminText.text(locale, roleLabel[entry.role])}</p>
        <p className="break-all font-mono text-sm">{entry.model}</p>
        <p className="text-sm">{entry.routeConfigured === true ? adminText.text(locale, "routeConfigured") : entry.routeConfigured === false ? adminText.text(locale, "routeNotConfigured") : adminText.text(locale, "routeUnknown")}</p>
        {observed && Number.isFinite(+observed) && <p className="text-xs text-muted-foreground">{adminText.text(locale, "lastObserved")}: {observed.toLocaleString(locale)}</p>}
      </li>;
    })}</ol> : <p className="text-sm text-muted-foreground">{adminText.text(locale, "waitingForModelConfiguration")}</p>}
  </section>;
}
