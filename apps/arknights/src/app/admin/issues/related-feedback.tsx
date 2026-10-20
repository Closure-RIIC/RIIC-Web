"use client";
import { useAdminFetch } from "../admin-context";
import { useEffect, useState } from "react";
import { useLocale } from "use-intl";
import { Button } from "@/components/ui/button";
import type { AdminFeedbackRecordData, ApiResponse } from "@/types";
type Related = { operators: string[]; matches: { feedback: AdminFeedbackRecordData; reason: string; operators: string[] }[]; links: { feedbackId: string; masterId: string }[] };
export function RelatedFeedback({ item, onChanged }: { item: AdminFeedbackRecordData; onChanged: () => void }) {
  const request = useAdminFetch();
  const en = useLocale() === "en";
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
  const reasons: Record<string, string> = en ? { same_diagnostic: "Same diagnostic", same_input: "Same full input", shared_room_operators: "Same facility and related operators", same_facility_error: "Same facility and error code" } : { same_diagnostic: "相同诊断", same_input: "相同完整输入", shared_room_operators: "相同设施且共享相关干员", same_facility_error: "相同设施且错误码一致" };
  return <section className="grid gap-3 border-t pt-4"><h3 className="font-medium">{en ? "Related issues" : "相似问题与人工关联"}</h3><p className="text-sm text-muted-foreground">{data?.operators.join(" · ")}</p>{error && <p role="alert">{error}</p>}{data?.links.map((entry) => <p key={entry.feedbackId} className="break-all text-sm">{entry.feedbackId} → {entry.masterId}{entry.feedbackId === item.id && <Button variant="ghost" disabled={busy} onClick={() => void link(null)}>{en ? "Unlink" : "拆分"}</Button>}</p>)}{data?.matches.map((match) => <article key={match.feedback.id} className="grid gap-2 rounded border p-3"><p className="text-sm">{match.feedback.note}</p><p className="text-xs text-muted-foreground">{reasons[match.reason]} {match.operators.join("、")}</p><Button variant="outline" disabled={busy} onClick={() => void link(match.feedback.id)}>{en ? "Confirm as main issue" : "确认关联到此主问题"}</Button></article>)}</section>;
}
