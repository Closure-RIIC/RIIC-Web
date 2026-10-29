"use client";

import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../../messages/zh-CN/AK_app_admin_issues_related_feedback.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_app_admin_issues_related_feedback");

import { useAdminFetch } from "../admin-context";
import { useEffect, useState } from "react";
import { useLocale } from "use-intl";
import { Button } from "@/components/ui/button";
import type { AdminFeedbackRecordData, ApiResponse } from "@riic/arknights-domain/types";
type Related = { operators: string[]; matches: { feedback: AdminFeedbackRecordData; reason: string; operators: string[] }[]; links: { feedbackId: string; masterId: string }[] };
export function RelatedFeedback({ item, onChanged }: { item: AdminFeedbackRecordData; onChanged: () => void }) {
  const request = useAdminFetch();
  const en = useLocale();
  const [data, setData] = useState<Related | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; void request(`/api/admin/quality?kind=related&id=${encodeURIComponent(item.id)}`, { cache: "no-store" }).then((response) => response.json()).then((body: ApiResponse<Related>) => { if (!active) return; if (body.success) setData(body.data); else setError(body.error.message); }).catch((error: Error) => { if (active) setError(error.message); }); return () => { active = false; }; }, [item.id, request]);
  async function link(masterId: string | null) {
    setBusy(true); setError("");
    try {
      const response = await request("/api/admin/quality", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "link", id: item.id, masterId, expectedUpdatedAt: item.updatedAt }) });
      const body = await response.json() as ApiResponse<unknown>;
      if (!body.success) throw new Error(body.error.message);
      onChanged();
    } catch (error) { setError(error instanceof Error ? error.message : "Link failed"); } finally { setBusy(false); }
  }
  const reasons: Record<string, string> = { same_diagnostic: uiText.text(en, "sameDiagnostic"), same_input: uiText.text(en, "sameFullInput"), shared_room_operators: uiText.text(en, "sameFacilityAndRelatedOperators"), same_facility_error: uiText.text(en, "sameFacilityAndErrorCode") };
  return <section className="grid gap-3 border-t pt-4"><h3 className="font-medium">{uiText.text(en, "relatedIssues")}</h3><p className="text-sm text-muted-foreground">{data?.operators.join(" · ")}</p>{error && <p role="alert">{error}</p>}{data?.links.map((entry) => <p key={entry.feedbackId} className="break-all text-sm">{entry.feedbackId} → {entry.masterId}{entry.feedbackId === item.id && <Button variant="ghost" disabled={busy} onClick={() => void link(null)}>{uiText.text(en, "unlink")}</Button>}</p>)}{data?.matches.map((match) => <article key={match.feedback.id} className="grid gap-2 rounded border p-3"><p className="text-sm">{match.feedback.note}</p><p className="text-xs text-muted-foreground">{reasons[match.reason]} {match.operators.join("、")}</p><Button variant="outline" disabled={busy} onClick={() => void link(match.feedback.id)}>{uiText.text(en, "confirmAsMainIssue")}</Button></article>)}</section>;
}
