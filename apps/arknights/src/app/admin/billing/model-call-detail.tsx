"use client";

import { useLocale } from "use-intl";
import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
import type AdminMessages from "../../../../messages/zh-CN/Admin_billing_console.json";
import type { RelatedModelCall } from "@/billing-model-stats";

const text = createLocalizer<typeof AdminMessages>("Admin_billing_console");
type Row = Record<string, unknown>;

export function ModelCallDetail({ detail }: { detail: unknown }) {
  const locale = useLocale();
  if (!detail || typeof detail !== "object") return null;
  const record = detail as Row;
  const related = record.related_call as RelatedModelCall | undefined;
  const rows: Row[] = Array.isArray(record.calls) ? record.calls : related ? [{
    id: related.id, provider: related.provider, model: related.model, input_tokens: related.inputTokens,
    cached_input_tokens: related.cachedInputTokens, cache_write_tokens: related.cacheWriteTokens, output_tokens: related.outputTokens,
    upstream_rmb: related.upstreamRmb, charged_rmb: related.chargedRmb, pricing_tier: related.pricingTier,
  }] : [];
  if (!rows.length) return null;
  const show = (value: unknown) => value == null ? text.text(locale, "unknownNone") : String(value);
  const headings = ["statModel", "statInput", "statCachedInput", "statCacheWrite", "statOutput", "statCost", "statPriced"] as const;
  return <section className="mb-5 space-y-3" data-model-call-detail>
    <h3 className="text-sm font-semibold">{text.text(locale, "modelCallsDetail")}</h3>
    {related && <p className="text-xs leading-relaxed text-muted-foreground">{text.text(locale, "gatewayModelUsageHint")}</p>}
    <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{headings.map(key => <th key={key} className="whitespace-nowrap p-2">{text.text(locale, key)}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={String(row.id)} className="border-t">
        <td className="min-w-40 p-2"><p className="break-all">{show(row.provider)} / {show(row.model)}</p><p className="mt-1 text-muted-foreground">{text.text(locale, row.pricing_tier === "long-context" ? "longContextTier" : row.pricing_tier === "base" ? "baseTier" : "unknownNone")}</p></td>
        {["input_tokens", "cached_input_tokens", "cache_write_tokens", "output_tokens", "upstream_rmb", "charged_rmb"].map(key => <td key={key} className="whitespace-nowrap p-2 tabular-nums">{key === "cache_write_tokens" && row[key] == null ? text.text(locale, "cacheWriteNotRecorded") : show(row[key])}</td>)}
      </tr>)}</tbody></table></div>
  </section>;
}
