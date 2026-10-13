"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { useAdminRequest } from "../admin-context";
import { CodeHistory, type CodeHistoryData } from "./code-history";

type IssuedBatch = { batchId: string; points: number; codes: string[]; batchLabel: string | null; startsAt: string | null; expiresAt: string | null };

export function BillingCodes() {
  const t = useTranslations("AdminWorkspace");
  const locale = useLocale();
  const request = useAdminRequest();
  const [count, setCount] = useState("20");
  const [points, setPoints] = useState("30");
  const [custom, setCustom] = useState("");
  const [batchLabel, setBatchLabel] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [batch, setBatch] = useState<IssuedBatch | null>(null);
  const [history, setHistory] = useState<CodeHistoryData | null>(null);
  const [filters, setFilters] = useState({ q: "", status: "all", page: 1 });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const batchId = useRef<string | null>(null);
  const [attemptedBatchId, setAttemptedBatchId] = useState<string | null>(null);
  const issuing = useRef(false);
  const loadSequence = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      const params = new URLSearchParams({ ...filters, page: String(filters.page) });
      const data = await request<CodeHistoryData>(`/api/admin/billing/cdk?${params}`, { cache: "no-store" }, t("cdkLoadFailed"));
      if (sequence === loadSequence.current) setHistory(data);
    } catch (cause) {
      if (sequence === loadSequence.current) setLoadError(cause instanceof Error ? cause.message : t("cdkLoadFailed"));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [request, t, filters]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function generate() {
    if (issuing.current || batch) return;
    issuing.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      batchId.current ??= crypto.randomUUID();
      setAttemptedBatchId(batchId.current);
      const codes = custom.trim() ? custom.trim().split(/\r?\n/).map(code => code.trim()).filter(Boolean) : undefined;
      const data = await request<IssuedBatch>("/api/admin/billing/cdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: batchId.current, count: Number(count), points: Number(points), codes, batchLabel,
          startsAt: startsAt ? new Date(startsAt).toISOString() : undefined, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined }),
      }, t("cdkGenerateFailed"));
      setBatch(data);
      setConfirm(false);
      void refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("cdkGenerateFailed"));
      // Keep the batch ID after failures: the server may have committed even
      // when a response was lost. A retry must not issue extra points.
      void refresh();
    } finally {
      issuing.current = false;
      setBusy(false);
    }
  }

  async function copy(links = false) {
    if (!batch) return;
    try {
      await navigator.clipboard.writeText(batch.codes.map(code => links ? `${window.location.origin}/billing#redeem=${encodeURIComponent(code)}` : code).join("\n"));
      setNotice(t("cdkCopied"));
    } catch {
      setNotice(t("cdkCopyFailed"));
    }
  }

  function download() {
    if (!batch) return;
    const blob = new Blob([`# ${batch.batchLabel ?? batch.batchId}\n# ${batch.points} points / code\n# Starts: ${batch.startsAt ?? "immediately"}\n# Expires: ${batch.expiresAt ?? "never"}\n${batch.codes.join("\n")}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `riic-codes-${batch.batchId}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(t("cdkDownloaded"));
  }

  const total = Number(count) * Number(points);
  return <>
    <Card><CardContent><form onSubmit={event => { event.preventDefault(); setError(""); setConfirm(true); }} className="grid gap-5">
      <div><h2 className="font-semibold">{t("cdkCreate")}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{t("cdkGrantHint")}</p></div>
      <fieldset disabled={busy || Boolean(batch) || confirm} className="grid gap-5">
        <div className="grid gap-2"><Label htmlFor="cdk-label">{t("cdkBatchLabel")}</Label><Input id="cdk-label" maxLength={80} value={batchLabel} onChange={event => setBatchLabel(event.target.value)} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2"><Label htmlFor="cdk-count">{t("cdkCount")}</Label><Input id="cdk-count" type="number" min={1} max={100} step={1} required value={count} onChange={event => setCount(event.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="cdk-points">{t("cdkPoints")}</Label><Input id="cdk-points" type="number" min={1} max={100000} step={1} required value={points} onChange={event => setPoints(event.target.value)} /></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2"><Label htmlFor="cdk-start">{t("cdkStartsAt")}</Label><Input id="cdk-start" type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="cdk-expiry">{t("cdkExpiresAt")}</Label><Input id="cdk-expiry" type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></div>
        </div>
        <p className="text-xs text-muted-foreground">{t("cdkTimeHint")}</p>
        <div className="grid gap-2"><Label htmlFor="cdk-custom">{t("cdkCustom")}</Label><Textarea id="cdk-custom" value={custom} onChange={event => setCustom(event.target.value)} maxLength={7000} rows={4} spellCheck={false} autoCapitalize="characters" autoComplete="off" aria-describedby="cdk-custom-hint" /><p id="cdk-custom-hint" className="text-xs leading-5 text-muted-foreground">{t("cdkCustomHint")}</p></div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm" aria-live="polite">{t("cdkTotal", { count: Number.isFinite(total) ? total : 0 })}</p>
          <Button type="submit" disabled={busy || Boolean(batch)}>{t(busy ? "cdkGenerating" : "cdkGenerate")}</Button>
        </div>
      </fieldset>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {error && attemptedBatchId && <p className="break-all text-xs text-muted-foreground">{t("cdkFailedBatch", { id: attemptedBatchId })}</p>}
    </form></CardContent></Card>
    <Dialog open={confirm} onOpenChange={open => { if (!busy) setConfirm(open); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("cdkConfirmTitle")}</DialogTitle><DialogDescription>{t("cdkConfirmHint")}</DialogDescription></DialogHeader>
        <DialogBody><dl className="grid gap-3 text-sm"><div><dt className="text-muted-foreground">{t("cdkBatchLabel")}</dt><dd>{batchLabel || "—"}</dd></div><div><dt className="text-muted-foreground">{t("cdkGenerated", { count: Number(count), points: Number(points) })}</dt><dd className="font-semibold">{t("cdkTotal", { count: total })}</dd></div><div><dt className="text-muted-foreground">{t("cdkValidity")}</dt><dd>{startsAt ? new Date(startsAt).toLocaleString(locale) : t("cdkImmediately")} → {expiresAt ? new Date(expiresAt).toLocaleString(locale) : t("cdkNever")}</dd></div></dl>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}</DialogBody>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>{t("cdkCancel")}</Button><Button disabled={busy} onClick={() => void generate()}>{t(busy ? "cdkGenerating" : "cdkConfirmGenerate")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    {batch && <Card role="region" aria-labelledby="cdk-result-title"><CardContent className="grid gap-4">
      <div><h2 id="cdk-result-title" className="font-semibold">{t("cdkGenerated", { count: batch.codes.length, points: batch.points })}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{t("cdkSaveHint")}</p><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{batch.batchId}</p></div>
      <Textarea aria-label={t("cdkResult")} readOnly value={batch.codes.join("\n")} rows={8} className="font-mono text-xs" spellCheck={false} />
      <div className="flex flex-wrap gap-2"><Button type="button" onClick={() => void copy()}>{t("cdkCopy")}</Button><Button type="button" variant="outline" onClick={() => void copy(true)}>{t("cdkCopyLinks")}</Button><Button type="button" variant="outline" onClick={download}>{t("cdkDownload")}</Button><Button type="button" variant="ghost" onClick={() => { setBatch(null); batchId.current = null; setNotice(""); setCustom(""); }}>{t("cdkNextBatch")}</Button></div>
      <p role="status" className="text-sm text-muted-foreground">{notice}</p>
    </CardContent></Card>}
    <CodeHistory data={history} loading={loading} error={loadError} filters={filters} onFilter={setFilters} refresh={refresh} />
  </>;
}
