"use client";
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
const tabs = [
  ["summary", "用量与成本", "Usage & cost"], ["usage", "调用记录", "Runs"], ["wallets", "用户钱包", "Wallets"], ["ledger", "积分流水", "Ledger"],
  ["orders", "支付订单", "Orders"], ["rates", "模型费率", "Rates"], ["reviews", "对账", "Reconciliation"], ["codes", "兑换码", "Credit codes"], ["audit", "操作审计", "Audit"],
] as const;
const agentTabs = [["policies", "网关与过滤", "Gateway & filter"], ["filters", "过滤记录", "Filter events"], ["attempts", "网关请求", "Gateway requests"]] as const;
const columns: Record<string, string[]> = {
  usage: ["created_at", "user_id", "status", "settlement", "points", "input_tokens", "output_tokens", "upstream_cost_rmb_fen"],
  wallets: ["name", "email", "paid_points", "monthly_points", "monthly_expires_at", "held_paid_points", "held_monthly_points"],
  ledger: ["created_at", "user_id", "kind", "points_delta", "paid_points_after", "monthly_points_after", "reference_id"],
  orders: ["created_at", "user_id", "product_id", "status", "amount_fen", "points", "provider_order_id"],
  reviews: ["created_at", "run_id", "kind", "status", "resolution"], audit: ["created_at", "actor_id", "action", "target", "reason"],
  filters: ["created_at", "user_id", "stage", "version", "rule_ids"], attempts: ["created_at", "provider", "model", "call_id"],
};
const labels: Record<string, [string, string]> = {
  settlement: ["结算状态", "Settlement"],
  created_at: ["时间", "Time"], user_id: ["用户 ID", "User ID"], status: ["状态", "Status"], points: ["积分", "Points"], input_tokens: ["输入 token", "Input tokens"], output_tokens: ["输出 token", "Output tokens"], upstream_cost_rmb_fen: ["已知成本 ¥", "Known cost ¥"],
  name: ["用户", "User"], email: ["邮箱", "Email"], paid_points: ["永久积分", "Permanent points"], monthly_points: ["月卡积分", "Monthly points"], monthly_expires_at: ["月卡到期", "Monthly expiry"], held_paid_points: ["永久预留", "Reserved permanent"], held_monthly_points: ["月卡预留", "Reserved monthly"],
  kind: ["类型", "Kind"], points_delta: ["变动", "Change"], paid_points_after: ["永久余额", "Permanent balance"], monthly_points_after: ["月卡余额", "Monthly balance"], reference_id: ["关联记录", "Reference"], product_id: ["产品", "Product"], amount_fen: ["金额 ¥", "Amount ¥"], provider_order_id: ["支付订单号", "Provider order"], run_id: ["请求 ID", "Run ID"], resolution: ["处理结果", "Resolution"], actor_id: ["操作人", "Actor"], action: ["操作", "Action"], target: ["对象", "Target"], reason: ["原因", "Reason"], stage: ["阶段", "Stage"], version: ["版本", "Version"], rule_ids: ["命中规则", "Rules"], provider: ["供应商", "Provider"], model: ["模型", "Model"], call_id: ["调用 ID", "Call ID"],
};
export function BillingConsole({ agent = false }: { agent?: boolean }) {
  const zh = useLocale() === "zh"; const tr = (cn: string, en: string) => zh ? cn : en;
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
  const value = (key: string, v: unknown) => v === null || v === undefined ? tr("未知 / 无", "Unknown / none") : key.endsWith("_fen") ? (Number(v) / 100).toFixed(2) : key.endsWith("_at") ? new Date(String(v)).toLocaleString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  async function mutation(kind: string, body: unknown) {
    setSaving(true); setError("");
    try { const result = await request<Row>(`/api/admin/billing?section=${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); setAdjust(null); setReview(null); setNotice(`${tr("操作已记录", "Operation recorded")}${result.ledgerId ? ` · ${result.ledgerId}` : ""}${result.expiredPoints ? ` · ${tr("原月卡积分已过期", "Original monthly points expired")}: ${result.expiredPoints}` : ""}`); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }
  const isTable = !!columns[section];
  return <div className="space-y-5">
    <nav className="flex flex-wrap gap-1" aria-label={tr("计费管理", "Billing management")}>{(agent ? agentTabs : tabs).map(([id, cn, en]) => <Button key={id} size="sm" variant={section === id ? "default" : "ghost"} aria-current={section === id ? "page" : undefined} onClick={() => { setSection(id); setPage(1); setListing(null); setStatus(""); }}>{tr(cn, en)}</Button>)}</nav>
    {!['codes', 'rates', 'policies'].includes(section) && <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); setPage(1); setQuery(q); void reload(); }}>
      {isTable && <><Label>{tr("用户 / 关联 ID / 邮箱", "User / reference ID / email")}<Input value={q} onChange={e => setQ(e.target.value)} /></Label><Label>{tr("状态 / 类型（留空显示全部）", "Status / kind (blank for all)")}<Input value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} /></Label></>}
      <Label>{tr("开始日期（北京）", "From (Beijing)")}<Input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></Label><Label>{tr("结束日期（北京）", "To (Beijing)")}<Input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></Label><Button variant="outline" disabled={loading}>{tr("查询 / 刷新", "Search / refresh")}</Button>
    </form>}
    {error && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}
    {loading && <p role="status" className="text-sm text-muted-foreground">{tr("正在加载…", "Loading…")}</p>}
    {section === "summary" && summary && <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{([
      ["runs", tr("请求数", "Runs")], ["points", tr("已扣积分", "Points charged")], ["known_cost_fen", tr("已知模型成本 ¥", "Known model cost ¥")], ["unknown_cost_runs", tr("成本未确认请求", "Unknown-cost runs")], ["paid_fen", tr("已收款 ¥", "Payments ¥")], ["paid_points", tr("永久积分存量", "Permanent points")], ["reserved_points", tr("预留积分", "Reserved points")], ["open_reviews", tr("待对账", "Open reviews")],
    ] as const).map(([key, label]) => <div key={key} className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value(key, summary[key])}</p></div>)}</div><p className="text-sm text-muted-foreground">{tr("默认最近 30 天。未知成本不计为零，需单独对账；收款和积分消耗为不同口径。钱包存量与待对账数量为当前值。", "Last 30 days by default. Unknown costs require reconciliation; they are not zero. Payments and point consumption are separate measures. Wallet balances and open reviews are current totals.")}</p><div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead><tr>{[tr("日期", "Date"),tr("请求", "Runs"),tr("积分", "Points"),tr("已知成本 ¥", "Known cost ¥"),tr("未确认", "Unknown")].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{(summary.series as Row[] ?? []).map(row => <tr key={String(row.day)} className="border-t">{["day","runs","points","known_cost_fen","unknown_cost_runs"].map(key => <td key={key} className="p-3 tabular-nums">{value(key,row[key])}</td>)}</tr>)}</tbody></table></div></>}
    {isTable && listing && <><div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead><tr>{columns[section].map(key => <th className="whitespace-nowrap p-3" key={key}>{labels[key]?.[zh ? 0 : 1] ?? key}</th>)}<th className="p-3">{tr("操作", "Actions")}</th></tr></thead><tbody>{listing.rows.map((row, index) => <tr key={String(row.id ?? row.user_id ?? index)} className="border-t">{columns[section].map(key => <td key={key} className="max-w-64 truncate p-3 tabular-nums" title={value(key,row[key])}>{value(key,row[key])}</td>)}<td className="p-3"><div className="flex gap-1"><Button size="sm" variant="ghost" onClick={async () => { try { setDetail(section === "usage" && row.run_id ? await request(`/api/admin/billing?section=run&id=${encodeURIComponent(String(row.run_id))}`) : row); } catch (e) { setError(String(e)); } }}>{tr("详情", "Details")}</Button>
      {section === "wallets" && <Button size="sm" variant="outline" onClick={() => setAdjust({ userId: String(row.user_id), action: "credit", referenceId: "", points: "", reason: "", idempotencyKey: crypto.randomUUID() })}>{tr("调账", "Adjust")}</Button>}
      {section === "ledger" && Number(row.points_delta) < 0 && <Button size="sm" variant="outline" onClick={() => setAdjust({ userId: String(row.user_id), action: "refund", referenceId: String(row.id), points: "", reason: "", idempotencyKey: crypto.randomUUID() })}>{tr("退还", "Refund")}</Button>}
      {section === "reviews" && row.status === "open" && <Button size="sm" variant="outline" onClick={() => setReview({ id: String(row.id), reason: "", resolution: "platform_absorbed", ledgerId: "" })}>{tr("处理", "Resolve")}</Button>}
    </div></td></tr>)}</tbody></table>{!listing.rows.length && <p className="p-8 text-center text-sm text-muted-foreground">{tr("没有符合条件的记录", "No matching records")}</p>}</div><div className="flex items-center justify-between"><span className="text-sm">{listing.total} {tr("条记录", "records")} · {listing.page}/{listing.pages}</span><div className="flex gap-2"><Button variant="outline" disabled={loading || page <= 1} onClick={() => setPage(page-1)}>{tr("上一页", "Previous")}</Button><Button variant="outline" disabled={loading || page >= listing.pages} onClick={() => setPage(page+1)}>{tr("下一页", "Next")}</Button></div></div></>}
    {section === "codes" && <BillingCodes />}
    {["rates","policies"].includes(section) && policies && <>{section === "policies" && <div className="rounded-xl border bg-card p-4"><h2 className="font-semibold">{tr("网关同步状态", "Gateway sync status")}</h2>{policies.gateway.length ? policies.gateway.map(row => <p key={String(row.id)} className="mt-2 text-sm">{String(row.id)} · {String(row.status)} · {String(row.filter_version)} · {value("updated_at",row.updated_at)}</p>) : <p className="mt-2 text-sm text-muted-foreground">{tr("等待网关工作进程上报", "Waiting for gateway worker")}</p>}<p className="mt-2 text-xs text-muted-foreground">{tr("DeepSeek 优先，故障时尝试 GLM。网关同步失败时仍执行应用层过滤；网关不可用时不绕过。", "DeepSeek first; GLM on failure. Application filtering remains active during gateway sync failures. An unavailable gateway is never bypassed.")}</p></div>}<PolicyEditor key={`${section}:${policies.versions.find(v => v.kind === (section === "rates" ? "rates" : "filter") && v.status === "active")?.id}`} kind={section === "rates" ? "rates" : "filter"} versions={policies.versions} refresh={reload} /></>}
    <Dialog open={detail !== null} onOpenChange={open => { if (!open) setDetail(null); }}><DialogContent className="sm:max-w-3xl"><DialogHeader><DialogTitle>{tr("记录详情", "Record details")}</DialogTitle><DialogDescription>{tr("金额保留原始精度，空值表示未确认或不适用。", "Amounts retain their original precision; null means unknown or not applicable.")}</DialogDescription></DialogHeader><DialogBody><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(detail,null,2)}</pre></DialogBody></DialogContent></Dialog>
    <Dialog open={!!adjust} onOpenChange={open => { if (!open && !saving) setAdjust(null); }}><DialogContent><DialogHeader><DialogTitle>{tr("积分调账", "Point adjustment")}</DialogTitle><DialogDescription>{tr("仅操作积分，不退还现金。退还以原扣费流水为依据，过期月卡积分不会恢复。", "Points only; no cash refunds. Refunds require an original debit. Expired monthly points remain expired.")}</DialogDescription></DialogHeader>{adjust && <DialogBody className="space-y-4"><p className="break-all text-xs">{adjust.userId} {adjust.referenceId}</p>{adjust.action !== "refund" && <Label>{tr("操作", "Action")}<select className="h-9 rounded-md border bg-background px-2" value={adjust.action} onChange={e => setAdjust({ ...adjust, action: e.target.value })}><option value="credit">{tr("补发永久积分", "Credit permanent points")}</option><option value="debit">{tr("补扣永久积分", "Debit permanent points")}</option></select></Label>}<Label>{tr("积分数", "Points")}<Input type="number" min="1" max="100000" value={adjust.points} onChange={e => setAdjust({ ...adjust, points: e.target.value })} /></Label><Label>{tr("操作原因", "Reason")}<Input value={adjust.reason} onChange={e => setAdjust({ ...adjust, reason: e.target.value })} /></Label>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</DialogBody>}<DialogFooter><Button disabled={saving || !adjust?.reason.trim() || !Number(adjust?.points)} onClick={() => void mutation("adjust",adjust)}>{tr("确认调账", "Confirm adjustment")}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!review} onOpenChange={open => { if (!open && !saving) setReview(null); }}><DialogContent><DialogHeader><DialogTitle>{tr("处理对账记录", "Resolve review")}</DialogTitle><DialogDescription>{tr("此操作记录处理结果；补扣或退还请先在钱包 / 流水完成，并填写对应流水 ID。", "This records the resolution. Complete point adjustments first, then attach the ledger ID.")}</DialogDescription></DialogHeader>{review && <DialogBody className="space-y-4"><Label>{tr("处理方式", "Resolution")}<select className="h-9 rounded-md border bg-background px-2" value={review.resolution} onChange={e => setReview({ ...review, resolution: e.target.value })}><option value="platform_absorbed">{tr("平台承担", "Platform absorbs")}</option><option value="verified">{tr("已核验无差异", "Verified, no discrepancy")}</option><option value="adjusted">{tr("已调账", "Adjusted")}</option></select></Label>{review.resolution === "adjusted" && <Label>{tr("调账流水 ID", "Adjustment ledger ID")}<Input value={review.ledgerId} onChange={e => setReview({ ...review, ledgerId: e.target.value })} /></Label>}<Label>{tr("处理依据", "Evidence / reason")}<Input value={review.reason} onChange={e => setReview({ ...review, reason: e.target.value })} /></Label>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</DialogBody>}<DialogFooter><Button disabled={saving || !review?.reason.trim()} onClick={() => void mutation("review",review)}>{tr("确认处理", "Resolve")}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
