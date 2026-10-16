"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { Check, CalendarCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { SklandAttendanceView } from "@/skland-attendance";

export function SklandAttendance({ accountId, uid }: { accountId: string; uid: string }) {
  const t = useTranslations("SklandAttendance");
  const [view, setView] = useState<SklandAttendanceView | null>(null);
  const [revision, setRevision] = useState(0);
  const [auto, setAuto] = useState(false), [loading, setLoading] = useState(true), [signing, setSigning] = useState(false), [error, setError] = useState("");
  const active = useRef(true), lock = useRef(false), automatic = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const storageKey = `riic.skland.attendance.auto:${accountId}:${uid}`;
  const endpoint = `/api/skland/attendance?${new URLSearchParams({ accountId, uid })}`;
  const api = async (method: "GET" | "POST", signal?: AbortSignal) => {
    const response = await fetch(endpoint, { method, credentials: "same-origin", cache: "no-store", signal });
    const payload = await response.json() as { success?: boolean; data?: SklandAttendanceView; error?: { message?: string } };
    if (!response.ok || !payload.success || !payload.data || payload.data.uid !== uid) throw new Error(payload.error?.message || t("failed"));
    return payload.data;
  };
  const sign = async () => {
    if (lock.current) return;
    lock.current = true; setSigning(true); setError("");
    const controller = new AbortController(); pending.current = controller;
    try { const next = await api("POST", controller.signal); if (active.current) setView(next); }
    catch (error) { if (active.current && !controller.signal.aborted) setError(error instanceof Error ? error.message : t("failed")); }
    finally { lock.current = false; if (active.current) setSigning(false); }
  };
  useEffect(() => {
    active.current = true;
    setLoading(true); setError("");
    const controller = new AbortController();
    try { automatic.current = localStorage.getItem(storageKey) === "1"; setAuto(automatic.current); } catch { /* Default to manual when storage is unavailable. */ }
    void (async () => {
      try {
        const next = await api("GET", controller.signal);
        if (!active.current || controller.signal.aborted) return;
        setView(next);
        if (automatic.current && !next.hasToday) await sign();
      } catch (error) { if (active.current && !controller.signal.aborted) setError(error instanceof Error ? error.message : t("failed")); }
      finally { if (active.current && !controller.signal.aborted) setLoading(false); }
    })();
    return () => { active.current = false; controller.abort(); pending.current?.abort(); };
    // The parent keys this panel by account and UID; each mount owns one request scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, uid, revision]);
  return <section className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-card-foreground" data-skland-attendance>
    <div className="min-w-0"><h2 className="flex items-center gap-2 text-sm font-semibold"><CalendarCheck className="size-4" aria-hidden="true" />{t("title")}</h2>
      <p className="mt-1 text-xs text-muted-foreground" role="status">{loading ? t("loading") : view?.hasToday ? t("done") : view ? t("notYet") : t("unavailable")}{view?.date ? ` · ${view.date}` : ""}</p>
      {view?.awards.length ? <p className="mt-1 text-xs">{t("rewards", { awards: view.awards.map(a => `${a.name} × ${a.count}`).join("、") })}</p> : null}
      {error ? <p role="alert" className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2"><Label htmlFor={`attendance-auto-${uid}`} className="text-xs">{t("auto")}</Label><Switch id={`attendance-auto-${uid}`} aria-label={t("auto")} checked={auto} onCheckedChange={checked => {
        automatic.current = checked; setAuto(checked);
        try { localStorage.setItem(storageKey, checked ? "1" : "0"); } catch { setError(t("storageFailed")); }
        if (checked && view && !view.hasToday && !loading) void sign();
      }} /></div>
      <Button type="button" variant="outline" className="min-h-11 rounded-full sm:min-h-9" disabled={loading || signing || view?.hasToday === true} onClick={() => { if (!view) setRevision(v => v + 1); else void sign(); }}>{view?.hasToday ? <Check aria-hidden="true" /> : <CalendarCheck aria-hidden="true" />}{signing ? t("signing") : view?.hasToday ? t("done") : !view && !loading ? t("retry") : t("sign")}</Button>
    </div>
    <p className="w-full text-[11px] text-muted-foreground">{t("hint")}</p>
  </section>;
}
