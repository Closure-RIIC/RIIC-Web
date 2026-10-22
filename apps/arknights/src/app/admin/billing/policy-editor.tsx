"use client";
import { useState } from "react";
import { useLocale } from "use-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useAdminRequest } from "../admin-context";
import type { RatePolicy } from "@/server/billing/rate-policy";
import type { FilterPolicy } from "@/server/agent/filter-policy";

export type PolicyVersion = { id: string; kind: "rates" | "filter"; status: string; payload: RatePolicy | FilterPolicy; created_at: string };
export function PolicyEditor({ kind, versions, refresh }: { kind: "rates" | "filter"; versions: PolicyVersion[]; refresh: () => Promise<void> }) {
  const zh = useLocale() === "zh"; const tr = (cn: string, en: string) => zh ? cn : en;
  const active = versions.find(v => v.kind === kind && v.status === "active")!;
  const [payload, setPayload] = useState<RatePolicy | FilterPolicy>(() => structuredClone(active.payload));
  const [reason, setReason] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [testText, setTestText] = useState(""); const [testResult, setTestResult] = useState("");
  const [confirm, setConfirm] = useState<{ action: string; id: string } | null>(null);
  const request = useAdminRequest();
  async function save(action: string, id?: string) {
    setBusy(true); setError("");
    try {
      await request("/api/admin/billing?section=policies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id, kind, payload, reason, expectedActive: active.id }) });
      setConfirm(null); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const rates = payload as RatePolicy; const filter = payload as FilterPolicy;
  const updateModel = (index: number, field: string, value: string, peak = false) => setPayload({ ...rates, models: rates.models.map((r, i) => i !== index ? r : peak ? { ...r, peak: { ...r.peak!, [field]: value } } : { ...r, [field]: value }) });
  return <section className="space-y-5 rounded-xl border bg-card p-5">
    <div><h2 className="font-semibold">{kind === "rates" ? tr("模型费率", "Model rates") : tr("基础内容过滤", "Basic content filter")} · {active.id}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{kind === "rates" ? tr("金额为每百万 token 的供应商价格。发布后仅影响新请求；1 积分 = ¥0.10，成功求解工具 1 积分。", "Provider prices per million tokens. Published rates apply to new requests. One point = ¥0.10; successful solver calls cost one point.") : tr("输入命中时拒绝且不扣费；流式文本命中时遮盖。模式中的 ? 匹配一个字符，不支持任意正则。允许词仅豁免其覆盖的片段。此基础过滤不包含图片语义审核。", "Blocked input is rejected without charge; matching streamed text is masked. Patterns support ? for one character. Allow phrases exempt only their matching spans. Image semantics are not moderated by this basic filter.")}</p></div>
    {kind === "rates" ? <>
      <Label>{tr("服务倍率", "Service multiplier")}<Input value={rates.markup} onChange={e => setPayload({ ...rates, markup: e.target.value })} inputMode="decimal" /></Label>
      {rates.models.map((model, index) => <fieldset key={model.provider} className="space-y-3 rounded-lg border p-4"><legend className="px-2 text-sm font-medium">{model.model}</legend>
        <div className="grid gap-3 sm:grid-cols-3"><Label>{tr("币种", "Currency")}<select className="h-9 rounded-md border bg-background px-2" value={model.currency} onChange={e => updateModel(index, "currency", e.target.value)}><option>RMB</option><option>USD</option></select></Label>
          <Label>{tr("人民币汇率", "RMB exchange rate")}<Input value={model.exchangeRate} onChange={e => updateModel(index, "exchangeRate", e.target.value)} /></Label></div>
        {[false, ...(model.peak ? [true] : [])].map(peak => <div key={String(peak)} className="grid gap-3 sm:grid-cols-3">{(["input", "cachedInput", "output"] as const).map(field => <Label key={field}>{peak ? tr("高峰 · ", "Peak · ") : ""}{({ input: tr("输入", "Input"), cachedInput: tr("缓存输入", "Cached input"), output: tr("输出", "Output") })[field]}<Input inputMode="decimal" value={(peak ? model.peak! : model)[field]} onChange={e => updateModel(index, field, e.target.value, peak)} /></Label>)}</div>)}
      </fieldset>)}
      <p className="text-xs text-muted-foreground">{tr("DeepSeek 高峰：北京时间周一至周五 09–12、14–18。账单先汇总精确金额，再四舍五入到 4 位小数积分。", "DeepSeek peak: Monday–Friday, 09–12 and 14–18 Beijing time. Exact amounts are summed before rounding credits to four decimal places.")}</p>
    </> : <>
      <div className="space-y-2">{filter.rules.map((rule, i) => <div key={rule.id} className="flex flex-wrap items-center gap-2">
        <input type="checkbox" aria-label={tr("启用词条", "Enable rule")} checked={rule.enabled} onChange={e => setPayload({ ...filter, rules: filter.rules.map((r, j) => i === j ? { ...r, enabled: e.target.checked } : r) })} />
        <select className="h-9 rounded-md border bg-background px-2 text-sm" aria-label={tr("规则类型", "Rule type")} value={rule.kind} onChange={e => setPayload({ ...filter, rules: filter.rules.map((r, j) => i === j ? { ...r, kind: e.target.value as "word" | "pattern" } : r) })}><option value="word">{tr("词语", "Word")}</option><option value="pattern">{tr("模式", "Pattern")}</option></select>
        <Input className="min-w-40 flex-1" aria-label={tr("过滤词条", "Filter rule")} value={rule.text} onChange={e => setPayload({ ...filter, rules: filter.rules.map((r, j) => i === j ? { ...r, text: e.target.value } : r) })} />
        <Button variant="ghost" onClick={() => setPayload({ ...filter, rules: filter.rules.filter((_, j) => i !== j) })}>{tr("删除", "Remove")}</Button>
      </div>)}</div>
      <Button variant="outline" onClick={() => setPayload({ ...filter, rules: [...filter.rules, { id: crypto.randomUUID(), kind: "word", text: "", enabled: true }] })}>{tr("添加词条", "Add rule")}</Button>
      <Label>{tr("允许词组（每行一条）", "Allow phrases (one per line)")}<Textarea value={filter.allow.join("\n")} onChange={e => setPayload({ ...filter, allow: e.target.value.split("\n").filter(Boolean) })} /></Label>
      <Label>{tr("测试文本（不会保存）", "Test text (not stored)")}<Textarea value={testText} onChange={e => setTestText(e.target.value)} /></Label>
      <Button variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { const r = await request<{ masked: { text: string }; matches: unknown[] }>("/api/admin/billing?section=filter-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: testText, policy: payload }) }); setTestResult(`${r.matches.length} ${tr("处命中", "matches")}\n${r.masked.text}`); } catch (e) { setError(String(e)); } finally { setBusy(false); } }}>{tr("测试规则", "Test rules")}</Button>
      {testResult && <pre className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm">{testResult}</pre>}
    </>}
    <Label>{tr("变更原因", "Change reason")}<Input value={reason} onChange={e => setReason(e.target.value)} maxLength={500} /></Label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button disabled={busy || !reason.trim()} onClick={() => void save("draft")}>{tr("保存草稿", "Save draft")}</Button>
    <div className="space-y-2 border-t pt-4">{versions.filter(v => v.kind === kind).slice(0, 12).map(v => <div key={v.id} className="flex flex-wrap items-center gap-2 text-sm"><span className="mr-auto">{v.id} · {v.status} · {new Date(v.created_at).toLocaleString()}</span><Button size="sm" variant="ghost" onClick={() => setPayload(structuredClone(v.payload))}>{tr("载入编辑", "Load")}</Button>{v.status !== "active" && <Button size="sm" variant="outline" disabled={busy || !reason.trim()} onClick={() => setConfirm({ action: v.status === "draft" ? "publish" : "rollback", id: v.id })}>{v.status === "draft" ? tr("发布", "Publish") : tr("回滚至此版本", "Restore this version")}</Button>}</div>)}</div>
    <Dialog open={!!confirm} onOpenChange={open => { if (!open && !busy) setConfirm(null); }}><DialogContent><DialogHeader><DialogTitle>{tr("确认发布配置", "Publish configuration")}</DialogTitle><DialogDescription>{tr("新请求将使用此配置。正在进行的请求继续使用原版本。网关同步状态可在上方查看。", "New requests will use this configuration. In-flight requests retain their original version. Gateway sync status is shown above.")} {confirm?.id}</DialogDescription></DialogHeader><DialogFooter><Button disabled={busy} onClick={() => confirm && void save(confirm.action, confirm.id)}>{tr("确认发布", "Confirm publish")}</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
