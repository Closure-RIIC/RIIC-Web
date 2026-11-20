"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useLocale } from "use-intl";
import type Messages from "../../../../messages/zh-CN/Admin_billing_console.json";
import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
import { referralRuleMaximums, type ReferralRules } from "@riic/contracts/referral";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdminRequest } from "../admin-context";

const text = createLocalizer<typeof Messages>("Admin_billing_console");
const ruleFields = [
  ["rewardPoints", "referralInviterAmount"], ["inviteePoints", "referralInviteeAmount"], ["rewardLimit", "referralLimit"],
] as const;
type Campaign = ReferralRules & {
  enabled: boolean;
  updatedAt: string | null;
  stats: { registeredCount: number; qualifiedCount: number; rewardedCount: number; earnedPoints: number; welcomePoints: number };
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
  const operation = useRef<{ payload: string; idempotencyKey: string } | null>(null);
  const reload = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const result = await request<Campaign>("/api/admin/billing?section=referral");
      if (seq === sequence.current) { setData(result); setError(""); }
    } catch (caught) { if (seq === sequence.current) setError(caught instanceof Error ? caught.message : String(caught)); }
  }, [request]);
  useEffect(() => { void reload(); const counter = sequence; return () => { counter.current++; }; }, [reload]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || saving || !reason.trim()) return;
    const form = new FormData(event.currentTarget);
    const desired = {
      enabled: form.has("enabled"), rewardPoints: Number(form.get("rewardPoints")),
      inviteePoints: Number(form.get("inviteePoints")), rewardLimit: Number(form.get("rewardLimit")),
      reason: reason.trim(), expectedUpdatedAt: data.updatedAt,
    };
    const payload = JSON.stringify(desired);
    if (operation.current?.payload !== payload) {
      operation.current = { payload, idempotencyKey: crypto.randomUUID() };
    }
    ++sequence.current;
    setSaving(true); setError(""); setNotice("");
    try {
      const updated = await request<Campaign>("/api/admin/billing?section=referral", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...desired, idempotencyKey: operation.current.idempotencyKey }),
      });
      setData(updated);
      operation.current = null; setReason(""); setNotice(text.text(locale, "operationRecorded"));
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setSaving(false); }
  }

  return <section className="space-y-4" data-billing-referral>
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <h2 className="font-semibold">{text.text(locale, "referralTitle")}</h2>
      <p className="text-sm text-muted-foreground">{text.text(locale, "referralRules")}</p>
      <p className="text-sm text-muted-foreground">{text.text(locale, "referralPauseRules")}</p>
      {data && <p className="text-sm font-medium" role="status">{text.text(locale, data.enabled ? "referralEnabled" : "referralDisabled")}</p>}
      {data && <form key={data.updatedAt} onSubmit={save}>
        <fieldset disabled={saving} className="space-y-4">
          <Label><input type="checkbox" name="enabled" defaultChecked={data.enabled} />{text.text(locale, "referralEnable")}</Label>
          <div className="grid gap-3 sm:grid-cols-3">{ruleFields.map(([key, label]) =>
            <Label key={key} className="grid gap-2">{text.text(locale, label)}
              <Input name={key} type="number" min={1} max={referralRuleMaximums[key]} step={1} required defaultValue={data[key]} />
            </Label>)}</div>
          <Label className="grid max-w-xl gap-2">{text.text(locale, "referralReason")}<Input value={reason} maxLength={500} required onChange={event => setReason(event.target.value)} /></Label>
          <Button type="submit" disabled={saving || !reason.trim()}>{text.text(locale, "referralSave")}</Button>
        </fieldset>
      </form>}
      <Button variant="outline" disabled={saving} onClick={() => void reload()}>{text.text(locale, "referralRefresh")}</Button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {data && <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{([
      ["registeredCount", "referralRegistered"], ["qualifiedCount", "referralQualified"], ["rewardedCount", "referralRewarded"], ["earnedPoints", "referralPoints"],
      ["welcomePoints", "referralWelcomeTotal"],
    ] as const).map(([key, label]) => <div key={key} className="rounded-xl border bg-card p-4"><dt className="text-sm text-muted-foreground">{text.text(locale, label)}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{data.stats[key]}</dd></div>)}</dl>}
  </section>;
}
