"use client";

import { useLocale } from "use-intl";
import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
import type AdminMessages from "../../../../messages/zh-CN/Admin_billing_console.json";
import type { BillingModelStats } from "@/billing-model-stats";
import { formatModelMoney } from "./model-money";

const text = createLocalizer<typeof AdminMessages>("Admin_billing_console");
export function ModelUsageSummary({ rows, gateway = false }: { rows: BillingModelStats[]; gateway?: boolean }) {
  const locale = useLocale();
  const number = (value: number | string | null | undefined) => value == null ? text.text(locale, "unknownNone") : BigInt(value).toLocaleString(locale);
  const money = (value: string | null) => value === null ? text.text(locale, "unknownNone") : formatModelMoney(value);
  const columns = ["statModel", "statCalls", "statInput", "statCachedInput", "statCacheWrite", "statOutput", "statCost", "statPriced", "statLongContext", "statUnknownUsage", "statUnknownCost", "statReview"] as const;
  return <section className="space-y-3 rounded-xl border bg-card p-4" data-model-usage-summary>
    <h2 className="font-semibold">{text.text(locale, "modelUsageSummary")}</h2>
    <p className="text-xs leading-relaxed text-muted-foreground">{text.text(locale, "modelUsageSummaryHint")}</p>
    {gateway && <p className="text-xs leading-relaxed text-muted-foreground">{text.text(locale, "gatewayModelUsageHint")}</p>}
    {rows.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{columns.map(key => <th key={key} className="whitespace-nowrap px-3 py-2 font-medium">{text.text(locale, key)}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={`${row.provider}/${row.model}`} className="border-t">
        <td className="min-w-44 px-3 py-3"><p className="font-medium">{row.label || row.model || text.text(locale, "unknownNone")}</p><p className="mt-1 break-all text-xs text-muted-foreground">{row.provider ?? "—"} / {row.model ?? "—"}</p></td>
        {[number(row.calls), number(row.inputTokens), number(row.cachedInputTokens), row.cacheWriteTokens == null ? text.text(locale, "cacheWriteNotRecorded") : number(row.cacheWriteTokens), number(row.outputTokens), money(row.knownUpstreamRmb), money(row.knownChargedRmb), number(row.longContextCalls), number(row.unknownUsageCalls), number(row.unknownCostCalls), number(row.pendingReviewCalls)].map((value, index) => <td key={columns[index + 1]} className="whitespace-nowrap px-3 py-3 tabular-nums">{value}</td>)}
      </tr>)}</tbody></table></div> : <p className="py-3 text-sm text-muted-foreground">{text.text(locale, "noMatchingRecords")}</p>}
  </section>;
}
