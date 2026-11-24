"use client";
import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
import type AdminMessages from "../../../../messages/zh-CN/Admin_policy_editor.json";
const adminText = createLocalizer<typeof AdminMessages>("Admin_policy_editor");
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
import type { AgentModelPolicy } from "@/server/agent/model-policy";

export type PolicyVersion = { id: string; kind: "rates" | "filter" | "models"; status: string; payload: RatePolicy | FilterPolicy | AgentModelPolicy; created_at: string };
export function PolicyEditor({ versions, refresh }: { versions: PolicyVersion[]; refresh: () => Promise<void> }) {
  const kind = "filter";
  const locale = useLocale();
  const active = versions.find(v => v.kind === kind && v.status === "active")!;
  const [payload, setPayload] = useState<FilterPolicy>(() => structuredClone(active.payload as FilterPolicy));
  const [reason, setReason] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [testText, setTestText] = useState(""); const [testResult, setTestResult] = useState("");
  const [confirm, setConfirm] = useState<{ action: string; id: string } | null>(null);
  const request = useAdminRequest();
  async function save(action: string, id?: string) {
    if (!payload) return;
    setBusy(true); setError("");
    try {
      await request("/api/admin/billing?section=policies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id, kind, payload, reason, expectedActive: active?.id ?? null }) });
      setConfirm(null); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const filter = payload;
  return <section className="space-y-5 rounded-xl border bg-card p-5">
    <div><h2 className="font-semibold">{adminText.text(locale, "basicContentFilter")} · {active.id}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{adminText.text(locale, "blockedInputIsRejectedWithoutChargeMatchingStreamed")}</p></div>
      <div className="space-y-2">{filter.rules.map((rule, i) => <div key={rule.id} className="flex flex-wrap items-center gap-2">
        <input type="checkbox" aria-label={adminText.text(locale, "enableRule")} checked={rule.enabled} onChange={e => setPayload({ ...filter, rules: filter.rules.map((r, j) => i === j ? { ...r, enabled: e.target.checked } : r) })} />
        <select className="h-9 rounded-md border bg-background px-2 text-sm" aria-label={adminText.text(locale, "ruleType")} value={rule.kind} onChange={e => setPayload({ ...filter, rules: filter.rules.map((r, j) => i === j ? { ...r, kind: e.target.value as "word" | "pattern" } : r) })}><option value="word">{adminText.text(locale, "word")}</option><option value="pattern">{adminText.text(locale, "pattern")}</option></select>
        <Input className="min-w-40 flex-1" aria-label={adminText.text(locale, "filterRule")} value={rule.text} onChange={e => setPayload({ ...filter, rules: filter.rules.map((r, j) => i === j ? { ...r, text: e.target.value } : r) })} />
        <Button variant="ghost" onClick={() => setPayload({ ...filter, rules: filter.rules.filter((_, j) => i !== j) })}>{adminText.text(locale, "remove")}</Button>
      </div>)}</div>
      <Button variant="outline" onClick={() => setPayload({ ...filter, rules: [...filter.rules, { id: crypto.randomUUID(), kind: "word", text: "", enabled: true }] })}>{adminText.text(locale, "addRule")}</Button>
      <Label>{adminText.text(locale, "allowPhrasesOnePerLine")}<Textarea value={filter.allow.join("\n")} onChange={e => setPayload({ ...filter, allow: e.target.value.split("\n").filter(Boolean) })} /></Label>
      <Label>{adminText.text(locale, "testTextNotStored")}<Textarea value={testText} onChange={e => setTestText(e.target.value)} /></Label>
      <Button variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { const r = await request<{ masked: { text: string }; matches: unknown[] }>("/api/admin/billing?section=filter-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: testText, policy: payload }) }); setTestResult(`${r.matches.length} ${adminText.text(locale, "matches")}\n${r.masked.text}`); } catch (e) { setError(String(e)); } finally { setBusy(false); } }}>{adminText.text(locale, "testRules")}</Button>
      {testResult && <pre className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm">{testResult}</pre>}
    <Label>{adminText.text(locale, "changeReason")}<Input value={reason} onChange={e => setReason(e.target.value)} maxLength={500} /></Label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button disabled={busy || !reason.trim()} onClick={() => void save("draft")}>{adminText.text(locale, "saveDraft")}</Button>
    <div className="space-y-2 border-t pt-4">{versions.filter(v => v.kind === kind).slice(0, 12).map(v => <div key={v.id} className="flex flex-wrap items-center gap-2 text-sm"><span className="mr-auto">{v.id} · {v.status} · {new Date(v.created_at).toLocaleString()}</span><Button size="sm" variant="ghost" onClick={() => setPayload(structuredClone(v.payload as FilterPolicy))}>{adminText.text(locale, "load")}</Button>{v.status !== "active" && <Button size="sm" variant="outline" disabled={busy || !reason.trim()} onClick={() => setConfirm({ action: v.status === "draft" ? "publish" : "rollback", id: v.id })}>{v.status === "draft" ? adminText.text(locale, "publish") : adminText.text(locale, "restoreThisVersion")}</Button>}</div>)}</div>
    <Dialog open={!!confirm} onOpenChange={open => { if (!open && !busy) setConfirm(null); }}><DialogContent><DialogHeader><DialogTitle>{adminText.text(locale, "publishConfiguration")}</DialogTitle><DialogDescription>{adminText.text(locale, "newRequestsWillUseThisConfigurationInFlight")} {confirm?.id}</DialogDescription></DialogHeader><DialogFooter><Button disabled={busy} onClick={() => confirm && void save(confirm.action, confirm.id)}>{adminText.text(locale, "confirmPublish")}</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
