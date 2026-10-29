"use client";
import type LabelMessages from "../../../../messages/zh-CN/AdminBillingLabels.json";
import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
import type AdminMessages from "../../../../messages/zh-CN/Admin_billing_console.json";
const labelsText = createLocalizer<typeof LabelMessages>("AdminBillingLabels");
const adminText = createLocalizer<typeof AdminMessages>("Admin_billing_console");
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "use-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAdminRequest } from "../admin-context";
import { BillingCodes } from "./billing-codes";
import { PolicyEditor, type PolicyVersion } from "./policy-editor";

type Row = Record<string, unknown>;
type Listing = { rows: Row[]; total: number; page: number; pages: number };
const tabs = ["summary","usage","wallets","ledger","orders","rates","reviews","codes","audit"] as const;
const agentTabs = ["policies","filters","attempts"] as const;
const columns: Record<string, string[]> = {
  usage: ["created_at", "user_id", "status", "settlement", "points", "input_tokens", "output_tokens", "upstream_cost_rmb_fen"],
  wallets: ["name", "email", "paid_points", "monthly_points", "monthly_expires_at", "held_paid_points", "held_monthly_points"],
  ledger: ["created_at", "user_id", "kind", "points_delta", "paid_points_after", "monthly_points_after", "reference_id"],
  orders: ["created_at", "user_id", "product_id", "status", "amount_fen", "points", "provider_order_id"],
  reviews: ["created_at", "run_id", "kind", "status", "resolution"], audit: ["created_at", "actor_id", "action", "target", "reason"],
  filters: ["created_at", "user_id", "stage", "version", "rule_ids"], attempts: ["created_at", "provider", "model", "call_id"],
};
const labels = ["summary","usage","wallets","ledger","orders","rates","reviews","codes","audit","policies","filters","attempts","settlement","created_at","user_id","status","points","input_tokens","output_tokens","upstream_cost_rmb_fen","name","email","paid_points","monthly_points","monthly_expires_at","held_paid_points","held_monthly_points","kind","points_delta","paid_points_after","monthly_points_after","reference_id","product_id","amount_fen","provider_order_id","run_id","resolution","actor_id","action","target","reason","stage","version","rule_ids","provider","model","call_id"] as const;
export function BillingConsole({ agent = false }: { agent?: boolean }) {
  const locale = useLocale();
  const request = useAdminRequest(); const [section, setSection] = useState(agent ? "policies" : "summary");
  const [page, setPage] = useState(1); const [q, setQ] = useState(""); const [query, setQuery] = useState(""); const [status, setStatus] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [listing, setListing] = useState<Listing | null>(null); const [summary, setSummary] = useState<Row | null>(null);
  const [policies, setPolicies] = useState<{ versions: PolicyVersion[]; gateway: Row[] } | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState<unknown>(null); const sequence = useRef(0);
  const [adjust, setAdjust] = useState<{ userId: string; action: string; referenceId: string; points: string; reason: string; idempotencyKey: string } | null>(null);
  const [review, setReview] = useState<{ id: string; resolution: string; reason: string; ledgerId: string } | null>(null); const [saving, setSaving] = useState(false);
  const reload = useCallback(async () => {
    const seq = ++sequence.current; setLoading(true); setError("");
    try {
      if (section === "codes") return;
      const params = new URLSearchParams({ section: section === "rates" ? "policies" : section, page: String(page), q: query, status });
      if (from) params.set("from", new Date(`${from}T00:00:00+08:00`).toISOString());
      if (to) params.set("to", new Date(`${to}T23:59:59.999+08:00`).toISOString());
      const data = await request<Listing & Row & { versions: PolicyVersion[]; gateway: Row[] }>(`/api/admin/billing?${params}`);
      if (seq !== sequence.current) return;
      if (section === "summary") setSummary(data); else if (["rates", "policies"].includes(section)) setPolicies(data); else setListing(data);
    } catch (e) { if (seq === sequence.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (seq === sequence.current) setLoading(false); }
  }, [section, page, query, status, from, to, request]);
  useEffect(() => { void reload(); const counter = sequence; return () => { counter.current++; }; }, [reload]);
  const value = (key: string, v: unknown) => v === null || v === undefined ? adminText.text(locale, "unknownNone") : key.endsWith("_fen") ? (Number(v) / 100).toFixed(2) : key.endsWith("_at") ? new Date(String(v)).toLocaleString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  async function mutation(kind: string, body: unknown) {
    setSaving(true); setError("");
    try { const result = await request<Row>(`/api/admin/billing?section=${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); setAdjust(null); setReview(null); setNotice(`${adminText.text(locale, "operationRecorded")}${result.ledgerId ? ` · ${result.ledgerId}` : ""}${result.expiredPoints ? ` · ${adminText.text(locale, "originalMonthlyPointsExpired")}: ${result.expiredPoints}` : ""}`); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }
  const isTable = !!columns[section];
  return <div className="space-y-5">
    <nav className="flex flex-wrap gap-1" aria-label={adminText.text(locale, "billingManagement")}>{(agent ? agentTabs : tabs).map(id => <Button key={id} size="sm" variant={section === id ? "default" : "ghost"} aria-current={section === id ? "page" : undefined} onClick={() => { setSection(id); setPage(1); setListing(null); setStatus(""); }}>{labelsText.text(locale, id)}</Button>)}</nav>
    {!['codes', 'rates', 'policies'].includes(section) && <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); setPage(1); setQuery(q); void reload(); }}>
      {isTable && <><Label>{adminText.text(locale, "userReferenceIdEmail")}<Input value={q} onChange={e => setQ(e.target.value)} /></Label><Label>{adminText.text(locale, "statusKindBlankForAll")}<Input value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} /></Label></>}
      <Label>{adminText.text(locale, "fromBeijing")}<Input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></Label><Label>{adminText.text(locale, "toBeijing")}<Input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></Label><Button variant="outline" disabled={loading}>{adminText.text(locale, "searchRefresh")}</Button>
    </form>}
    {error && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}
    {loading && <p role="status" className="text-sm text-muted-foreground">{adminText.text(locale, "loading")}</p>}
    {section === "summary" && summary && <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{([
      ["runs", adminText.text(locale, "runs")], ["points", adminText.text(locale, "pointsCharged")], ["known_cost_fen", adminText.text(locale, "knownModelCost")], ["unknown_cost_runs", adminText.text(locale, "unknownCostRuns")], ["paid_fen", adminText.text(locale, "payments")], ["paid_points", adminText.text(locale, "permanentPoints")], ["reserved_points", adminText.text(locale, "reservedPoints")], ["open_reviews", adminText.text(locale, "openReviews")],
    ] as const).map(([key, label]) => <div key={key} className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value(key, summary[key])}</p></div>)}</div><p className="text-sm text-muted-foreground">{adminText.text(locale, "last30DaysByDefaultUnknownCostsRequire")}</p><div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead><tr>{[adminText.text(locale, "date"),adminText.text(locale, "runs2"),adminText.text(locale, "points"),adminText.text(locale, "knownCost"),adminText.text(locale, "unknown")].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{(summary.series as Row[] ?? []).map(row => <tr key={String(row.day)} className="border-t">{["day","runs","points","known_cost_fen","unknown_cost_runs"].map(key => <td key={key} className="p-3 tabular-nums">{value(key,row[key])}</td>)}</tr>)}</tbody></table></div></>}
    {isTable && listing && <><div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead><tr>{columns[section].map(key => <th className="whitespace-nowrap p-3" key={key}>{labels.includes(key as typeof labels[number]) ? labelsText.text(locale, key as keyof typeof LabelMessages) : key}</th>)}<th className="p-3">{adminText.text(locale, "actions")}</th></tr></thead><tbody>{listing.rows.map((row, index) => <tr key={String(row.id ?? row.user_id ?? index)} className="border-t">{columns[section].map(key => <td key={key} className="max-w-64 truncate p-3 tabular-nums" title={value(key,row[key])}>{value(key,row[key])}</td>)}<td className="p-3"><div className="flex gap-1"><Button size="sm" variant="ghost" onClick={async () => { try { setDetail(section === "usage" && row.run_id ? await request(`/api/admin/billing?section=run&id=${encodeURIComponent(String(row.run_id))}`) : row); } catch (e) { setError(String(e)); } }}>{adminText.text(locale, "details")}</Button>
      {section === "wallets" && <Button size="sm" variant="outline" onClick={() => setAdjust({ userId: String(row.user_id), action: "credit", referenceId: "", points: "", reason: "", idempotencyKey: crypto.randomUUID() })}>{adminText.text(locale, "adjust")}</Button>}
      {section === "ledger" && Number(row.points_delta) < 0 && <Button size="sm" variant="outline" onClick={() => setAdjust({ userId: String(row.user_id), action: "refund", referenceId: String(row.id), points: "", reason: "", idempotencyKey: crypto.randomUUID() })}>{adminText.text(locale, "refund")}</Button>}
      {section === "reviews" && row.status === "open" && <Button size="sm" variant="outline" onClick={() => setReview({ id: String(row.id), reason: "", resolution: "platform_absorbed", ledgerId: "" })}>{adminText.text(locale, "resolve")}</Button>}
    </div></td></tr>)}</tbody></table>{!listing.rows.length && <p className="p-8 text-center text-sm text-muted-foreground">{adminText.text(locale, "noMatchingRecords")}</p>}</div><div className="flex items-center justify-between"><span className="text-sm">{listing.total} {adminText.text(locale, "records")} · {listing.page}/{listing.pages}</span><div className="flex gap-2"><Button variant="outline" disabled={loading || page <= 1} onClick={() => setPage(page-1)}>{adminText.text(locale, "previous")}</Button><Button variant="outline" disabled={loading || page >= listing.pages} onClick={() => setPage(page+1)}>{adminText.text(locale, "next")}</Button></div></div></>}
    {section === "codes" && <BillingCodes />}
    {["rates","policies"].includes(section) && policies && <>{section === "policies" && <div className="rounded-xl border bg-card p-4"><h2 className="font-semibold">{adminText.text(locale, "gatewaySyncStatus")}</h2>{policies.gateway.length ? policies.gateway.map(row => <p key={String(row.id)} className="mt-2 text-sm">{String(row.id)} · {String(row.status)} · {String(row.filter_version)} · {value("updated_at",row.updated_at)}</p>) : <p className="mt-2 text-sm text-muted-foreground">{adminText.text(locale, "waitingForGatewayWorker")}</p>}<p className="mt-2 text-xs text-muted-foreground">{adminText.text(locale, "deepseekFirstGlmOnFailureApplicationFilteringRemains")}</p></div>}<PolicyEditor key={`${section}:${policies.versions.find(v => v.kind === (section === "rates" ? "rates" : "filter") && v.status === "active")?.id}`} kind={section === "rates" ? "rates" : "filter"} versions={policies.versions} refresh={reload} /></>}
    <Dialog open={detail !== null} onOpenChange={open => { if (!open) setDetail(null); }}><DialogContent className="sm:max-w-3xl"><DialogHeader><DialogTitle>{adminText.text(locale, "recordDetails")}</DialogTitle><DialogDescription>{adminText.text(locale, "amountsRetainTheirOriginalPrecisionNullMeansUnknown")}</DialogDescription></DialogHeader><DialogBody><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(detail,null,2)}</pre></DialogBody></DialogContent></Dialog>
    <Dialog open={!!adjust} onOpenChange={open => { if (!open && !saving) setAdjust(null); }}><DialogContent><DialogHeader><DialogTitle>{adminText.text(locale, "pointAdjustment")}</DialogTitle><DialogDescription>{adminText.text(locale, "pointsOnlyNoCashRefundsRefundsRequireAn")}</DialogDescription></DialogHeader>{adjust && <DialogBody className="space-y-4"><p className="break-all text-xs">{adjust.userId} {adjust.referenceId}</p>{adjust.action !== "refund" && <Label>{adminText.text(locale, "action")}<select className="h-9 rounded-md border bg-background px-2" value={adjust.action} onChange={e => setAdjust({ ...adjust, action: e.target.value })}><option value="credit">{adminText.text(locale, "creditPermanentPoints")}</option><option value="debit">{adminText.text(locale, "debitPermanentPoints")}</option></select></Label>}<Label>{adminText.text(locale, "points2")}<Input type="number" min="0.0001" max="100000" step="0.0001" value={adjust.points} onChange={e => setAdjust({ ...adjust, points: e.target.value })} /></Label><Label>{adminText.text(locale, "reason")}<Input value={adjust.reason} onChange={e => setAdjust({ ...adjust, reason: e.target.value })} /></Label>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</DialogBody>}<DialogFooter><Button disabled={saving || !adjust?.reason.trim() || !Number(adjust?.points)} onClick={() => void mutation("adjust",adjust)}>{adminText.text(locale, "confirmAdjustment")}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!review} onOpenChange={open => { if (!open && !saving) setReview(null); }}><DialogContent><DialogHeader><DialogTitle>{adminText.text(locale, "resolveReview")}</DialogTitle><DialogDescription>{adminText.text(locale, "thisRecordsTheResolutionCompletePointAdjustmentsFirst")}</DialogDescription></DialogHeader>{review && <DialogBody className="space-y-4"><Label>{adminText.text(locale, "resolution")}<select className="h-9 rounded-md border bg-background px-2" value={review.resolution} onChange={e => setReview({ ...review, resolution: e.target.value })}><option value="platform_absorbed">{adminText.text(locale, "platformAbsorbs")}</option><option value="verified">{adminText.text(locale, "verifiedNoDiscrepancy")}</option><option value="adjusted">{adminText.text(locale, "adjusted")}</option></select></Label>{review.resolution === "adjusted" && <Label>{adminText.text(locale, "adjustmentLedgerId")}<Input value={review.ledgerId} onChange={e => setReview({ ...review, ledgerId: e.target.value })} /></Label>}<Label>{adminText.text(locale, "evidenceReason")}<Input value={review.reason} onChange={e => setReview({ ...review, reason: e.target.value })} /></Label>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</DialogBody>}<DialogFooter><Button disabled={saving || !review?.reason.trim()} onClick={() => void mutation("review",review)}>{adminText.text(locale, "resolve2")}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
