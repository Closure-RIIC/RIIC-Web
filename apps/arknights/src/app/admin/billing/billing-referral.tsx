"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "use-intl";
import type Messages from "../../../../messages/zh-CN/Admin_billing_console.json";
import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdminRequest } from "../admin-context";

const text = createLocalizer<typeof Messages>("Admin_billing_console");
type Campaign = {
  enabled: boolean;
  updatedAt: string | null;
  stats: { registeredCount: number; qualifiedCount: number; rewardedCount: number; earnedPoints: number };
};

export function BillingReferral() {
  const locale = useLocale();
  const request = useAdminRequest();
  const [data, setData] = useState<Campaign | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const sequence = useRef(0);
  const operation = useRef<{ enabled: boolean; reason: string; expectedUpdatedAt: string | null; idempotencyKey: string } | null>(null);
  const reload = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const result = await request<Campaign>("/api/admin/billing?section=referral");
      if (seq === sequence.current) { setData(result); setError(""); }
    } catch (caught) { if (seq === sequence.current) setError(caught instanceof Error ? caught.message : String(caught)); }
  }, [request]);
  useEffect(() => { void reload(); const counter = sequence; return () => { counter.current++; }; }, [reload]);

  async function toggle() {
    if (!data || saving || !reason.trim()) return;
    const desired = { enabled: !data.enabled, reason: reason.trim(), expectedUpdatedAt: data.updatedAt };
    if (!operation.current || operation.current.enabled !== desired.enabled || operation.current.reason !== desired.reason || operation.current.expectedUpdatedAt !== desired.expectedUpdatedAt) {
      operation.current = { ...desired, idempotencyKey: crypto.randomUUID() };
    }
    setSaving(true); setError(""); setNotice("");
    try {
      await request("/api/admin/billing?section=referral", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(operation.current) });
      operation.current = null; setReason(""); setNotice(text.text(locale, "operationRecorded"));
      await reload();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setSaving(false); }
  }

  return <section className="space-y-4" data-billing-referral>
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <h2 className="font-semibold">{text.text(locale, "referralTitle")}</h2>
      <p className="text-sm text-muted-foreground">{text.text(locale, "referralRules")}</p>
      <p className="text-sm text-muted-foreground">{text.text(locale, "referralPauseRules")}</p>
      {data && <p className="text-sm font-medium" role="status">{text.text(locale, data.enabled ? "referralEnabled" : "referralDisabled")}</p>}
      <Label className="grid max-w-xl gap-2">{text.text(locale, "referralReason")}<Input value={reason} maxLength={500} disabled={saving} onChange={event => setReason(event.target.value)} /></Label>
      <div className="flex gap-2"><Button disabled={!data || saving || !reason.trim()} onClick={() => void toggle()}>{text.text(locale, data?.enabled ? "referralDisable" : "referralEnable")}</Button><Button variant="outline" disabled={saving} onClick={() => void reload()}>{text.text(locale, "referralRefresh")}</Button></div>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {data && <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{([
      ["registeredCount", "referralRegistered"], ["qualifiedCount", "referralQualified"], ["rewardedCount", "referralRewarded"], ["earnedPoints", "referralPoints"],
    ] as const).map(([key, label]) => <div key={key} className="rounded-xl border bg-card p-4"><dt className="text-sm text-muted-foreground">{text.text(locale, label)}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{data.stats[key]}</dd></div>)}</dl>}
  </section>;
}
