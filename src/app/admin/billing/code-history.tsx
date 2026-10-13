"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { useAdminRequest } from "../admin-context";

type CodeRecord = { id: string; points: number; status: string; availability: string; issuerUserId: string; redeemerUserId: string | null; createdAt: string; redeemedAt: string | null; batchId: string | null; batchLabel: string | null; startsAt: string | null; expiresAt: string | null; revokedAt: string | null; revokedBy: string | null; revokeReason: string | null };
export type CodeHistoryData = { codes: CodeRecord[]; summary: { total: number; available: number; redeemed: number; outstandingPoints: number }; total: number; page: number; pages: number };
type Filters = { q: string; status: string; page: number };
const statusKeys = { issued: "cdkIssued", scheduled: "cdkScheduled", expired: "cdkExpired", revoked: "cdkRevoked", redeemed: "cdkRedeemed" } as const;

export function CodeHistory({ data, loading, error, filters, onFilter, refresh }: { data: CodeHistoryData | null; loading: boolean; error: string; filters: Filters; onFilter: (filters: Filters) => void; refresh: () => Promise<void> }) {
  const t = useTranslations("AdminWorkspace");
  const locale = useLocale();
  const request = useAdminRequest();
  const [query, setQuery] = useState(filters.q);
  const [target, setTarget] = useState<{ id?: string; batchId?: string } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  const statusOptions = [{ value: "all", label: t("allStatuses") }, ...Object.entries(statusKeys).map(([value, key]) => ({ value, label: t(key) }))];
  const selectedStatus = statusOptions.find(option => option.value === filters.status)!;
  const date = (value: string | null) => value ? new Date(value).toLocaleString(locale) : "—";
  const selectTarget = (value: NonNullable<typeof target>) => { setTarget(value); setReason(""); setMutationError(""); };
  async function revoke() {
    if (!target || !reason.trim() || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMutationError("");
    try {
      const result = await request<{ revoked: number }>("/api/admin/billing/cdk", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...target, reason }) }, t("cdkRevokeFailed"));
      setTarget(null);
      setNotice(t("cdkRevokedCount", { count: result.revoked }));
      await refresh();
    } catch (cause) { setMutationError(cause instanceof Error ? cause.message : t("cdkRevokeFailed")); }
    finally { setBusy(false); inFlight.current = false; }
  }
  return <Card role="region" className="min-w-0" aria-labelledby="cdk-history-title"><CardContent className="grid min-w-0 gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="cdk-history-title" className="font-semibold">{t("cdkHistory")}</h2><Button variant="outline" disabled={loading} onClick={() => void refresh()}>{t(loading ? "cdkLoading" : "cdkRefresh")}</Button></div>
    <p className="text-sm text-muted-foreground">{t("cdkHistoryHint")}</p>
    {data && <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">{([
      ["cdkStatTotal", data.summary.total], ["cdkStatAvailable", data.summary.available], ["cdkStatRedeemed", data.summary.redeemed], ["cdkStatOutstanding", data.summary.outstandingPoints],
    ] as const).map(([label, value]) => <div key={label} className="rounded-lg bg-muted/40 p-3"><dt className="text-xs text-muted-foreground">{t(label)}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{value.toLocaleString(locale)}</dd></div>)}</dl>}
    <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); onFilter({ ...filters, q: query.trim(), page: 1 }); }}>
      <Input className="min-w-40 flex-1" maxLength={100} aria-label={t("cdkSearch")} placeholder={t("cdkSearch")} value={query} onChange={event => setQuery(event.target.value)} />
      <Combobox items={statusOptions} filteredItems={statusOptions} value={selectedStatus} inputValue={selectedStatus.label} itemToStringValue={option => option.label} isItemEqualToValue={(option, current) => option.value === current.value} onValueChange={option => { if (option) onFilter({ ...filters, status: option.value, page: 1 }); }}>
        <ComboboxInput readOnly aria-label={t("status")} className="h-9 w-36" />
        <ComboboxContent><ComboboxList>{option => <ComboboxItem key={option.value} value={option}>{option.label}</ComboboxItem>}</ComboboxList></ComboboxContent>
      </Combobox>
      <Button type="submit" variant="outline">{t("cdkSearchButton")}</Button>
    </form>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {notice && <Alert role="status"><AlertDescription>{notice}</AlertDescription></Alert>}
    {!loading && !error && data?.codes.length === 0 && <p className="text-sm text-muted-foreground">{t("cdkEmpty")}</p>}
    {data && data.codes.length > 0 && <div className="overflow-x-auto" aria-busy={loading}><table className="w-full text-left text-sm">
      <thead><tr className="border-b text-muted-foreground">{(["cdkBatchLabel", "cdkPoints", "status", "cdkValidity", "cdkRedeemer", "actions"] as const).map(key => <th scope="col" key={key} className="px-3 py-3 font-medium whitespace-nowrap">{t(key)}</th>)}</tr></thead>
      <tbody>{data.codes.map(record => <tr key={record.id} className="border-b align-top last:border-0">
        <td className="min-w-40 max-w-64 break-all px-3 py-3"><p>{record.batchLabel || (record.batchId ? t("cdkUnnamedBatch") : t("cdkUserGift"))}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{record.id}</p><p className="mt-1 text-xs text-muted-foreground">{date(record.createdAt)}</p></td>
        <td className="px-3 py-3 tabular-nums">{record.points}</td>
        <td className="max-w-56 px-3 py-3"><Badge variant={record.availability === "revoked" ? "destructive" : record.availability === "redeemed" ? "secondary" : "outline"}>{record.availability in statusKeys ? t(statusKeys[record.availability as keyof typeof statusKeys]) : record.availability}</Badge>{record.revokeReason && <p className="mt-1 break-words text-xs text-muted-foreground">{record.revokeReason}<br />{date(record.revokedAt)}<br />{record.revokedBy}</p>}</td>
        <td className="min-w-36 px-3 py-3 text-xs">{record.startsAt ? date(record.startsAt) : t("cdkImmediately")}<br />→ {record.expiresAt ? date(record.expiresAt) : t("cdkNever")}</td>
        <td className="max-w-56 break-all px-3 py-3 text-xs">{record.redeemerUserId ?? "—"}{record.redeemedAt && <div className="mt-1 text-muted-foreground">{date(record.redeemedAt)}</div>}</td>
        <td className="px-3 py-3">{record.batchId && record.status === "issued" && <div className="flex flex-col items-start gap-2"><Button size="sm" variant="outline" disabled={loading || busy} onClick={() => selectTarget({ id: record.id })}>{t("cdkRevokeOne")}</Button><Button size="sm" variant="ghost" disabled={loading || busy} onClick={() => selectTarget({ batchId: record.batchId! })}>{t("cdkRevokeBatch")}</Button></div>}</td>
      </tr>)}</tbody>
    </table></div>}
    {data && <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><p>{t("page", { page: data.page, total: data.pages })} · {t("resultCount", { count: data.total })}</p><div className="flex gap-2"><Button variant="outline" disabled={loading || data.page <= 1} onClick={() => onFilter({ ...filters, page: data.page - 1 })}>{t("previous")}</Button><Button variant="outline" disabled={loading || data.page >= data.pages} onClick={() => onFilter({ ...filters, page: data.page + 1 })}>{t("next")}</Button></div></div>}
    <Dialog open={Boolean(target)} onOpenChange={open => { if (!open && !busy) setTarget(null); }}><DialogContent>
      <DialogHeader><DialogTitle>{t(target?.batchId ? "cdkRevokeBatch" : "cdkRevokeOne")}</DialogTitle><DialogDescription>{t("cdkRevokeHint")}</DialogDescription></DialogHeader>
      <DialogBody><p className="break-all font-mono text-xs">{target?.batchId ?? target?.id}</p>
      <div className="grid gap-2"><Label htmlFor="cdk-reason">{t("cdkRevokeReason")}</Label><Textarea id="cdk-reason" maxLength={200} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} /></div>
      {mutationError && <Alert variant="destructive"><AlertDescription>{mutationError}</AlertDescription></Alert>}</DialogBody>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setTarget(null)}>{t("cdkCancel")}</Button><Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => void revoke()}>{t(busy ? "cdkRevoking" : "cdkConfirmRevoke")}</Button></DialogFooter>
    </DialogContent></Dialog>
  </CardContent></Card>;
}
