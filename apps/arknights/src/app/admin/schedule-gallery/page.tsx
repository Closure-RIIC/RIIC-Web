"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import { ArrowRight, Check, EyeOff, RefreshCw, Search, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileUploadDialog } from "@/components/FileUploadDialog";
import { lazyWithMessages } from "@/i18n/features-client";
import { galleryRequest } from "@/gallery-client";
import { GALLERY_STORAGE_KEY, readGallery, type GalleryEntry } from "@/schedule-gallery";
import { POSTER_MAX_BYTES, posterDataOnly, readPosterFile } from "@/schedule-poster-document";
import type { GalleryPublicRecord, GalleryStatus, GallerySubmission } from "@/gallery-publishing";
import { OperatorIdentity } from "@/components/operators/OperatorPickerParts";
import { operatorFor } from "@/operator-catalog";
import type { OperBoxEntry } from "@riic/arknights-domain/types";
import { manualEditableRooms } from "@/recycling-room";
import { manualRoomCapacity } from "@/manual-schedule";
import { posterProduct, posterRoomTitle } from "@/schedule-poster-model";
import { GalleryFacilityBadges } from "@/components/schedule-poster/GalleryFacilityBadges";

const Preview = lazyWithMessages(() => import("@/components/schedule-poster/GalleryPreview"), "apps/arknights/src/components/schedule-poster/GalleryPreview.tsx");
const SubmissionDialog = lazyWithMessages(() => import("@/components/schedule-poster/GallerySubmissionDialog"), "apps/arknights/src/components/schedule-poster/GallerySubmissionDialog.tsx");

function ReviewOperator({ name, training }: { name: string; training?: OperBoxEntry }) {
  const operator = operatorFor(name);
  return <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/20 p-2" title={name} data-review-operator={name}>
    <OperatorIdentity name={name} portrait={operator?.portrait} compact>
      {operator && <span className="text-xs text-muted-foreground">{operator.rarity}★</span>}
      {training && <span className="text-xs text-muted-foreground">E{training.elite} · Lv.{training.level}</span>}
    </OperatorIdentity>
  </div>;
}

function ReviewAssignments({ entry }: { entry: GalleryPublicRecord }) {
  const t = useTranslations("ScheduleGallery");
  const locale = useLocale();
  const [active, setActive] = useState(0);
  const doc = entry.document;
  const shift = doc.draft.shifts[active]!;
  const order = ["trade_post", "factory", "power_plant", "control_center", "dormitory", "meeting_room", "office", "workshop", "training_room", "recycling"];
  const rooms = manualEditableRooms(doc.layout).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  return <section className="min-w-0 space-y-3" data-review-assignments>
    <h3 className="text-sm font-semibold">{t("scheduleAssignments")}</h3>
    <Tabs value={String(active)} onValueChange={value => setActive(Number(value))}>
      <TabsList aria-label={t("scheduleAssignments")} className="h-auto flex-wrap">{doc.draft.shifts.map((_, index) => <TabsTrigger key={index} value={String(index)}>{t("shiftTab", { count: index + 1 })}</TabsTrigger>)}</TabsList>
      <TabsContent value={String(active)} className="min-w-0 space-y-3 pt-3">
        <p className="text-xs text-muted-foreground">{t("shiftHours", { hours: shift.durationHours })}</p>
        {rooms.map(room => {
          const assignment = shift.rooms[room.id];
          const product = posterProduct(doc, room, active, locale);
          return <div key={room.id} data-review-room={room.id} className="min-w-0 rounded-lg border border-border p-3">
            <div className="mb-3 flex flex-wrap items-center gap-2"><h4 className="text-sm font-medium">{posterRoomTitle(room, doc.layout, locale)}{room.kind === "dormitory" ? ` ${doc.layout.rooms.filter(item => item.kind === "dormitory").findIndex(item => item.id === room.id) + 1}` : ""}</h4>{product && <Badge variant="outline">{product.label}</Badge>}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{Array.from({ length: manualRoomCapacity(room) }, (_, slot) => {
              const name = assignment?.operators[slot];
              const auto = assignment?.autofillSlots?.includes(slot) || (assignment?.autofill && !assignment.autofillSlots?.length);
              return name ? <ReviewOperator key={slot} name={name} training={doc.operators.find(operator => operator.name === name) ?? entry.authorBox?.find(operator => operator.name === name)} /> : <div key={slot} className="flex min-h-14 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">{auto ? t("autoSlot") : t("emptySlot")}</div>;
            })}</div>
          </div>;
        })}
      </TabsContent>
    </Tabs>
  </section>;
}

export default function AdminGalleryPage() {
  const t = useTranslations("ScheduleGallery");
  const locale = useLocale();
  const [entries, setEntries] = useState<GalleryPublicRecord[]>([]);
  const [status, setStatus] = useState("pending");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<GalleryPublicRecord | null>(null);
  const [editor, setEditor] = useState<GalleryEntry | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const statuses = { pending: t("pending"), published: t("published"), rejected: t("rejected"), hidden: t("hidden") };
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const data = await galleryRequest<{ entries: GalleryPublicRecord[]; demo: boolean }>("admin", undefined, signal, true);
      if (signal?.aborted) return;
      setEntries(data.entries); setError("");
    } catch { if (!signal?.aborted) setError(t("adminLoadFailed")); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [t]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const filtered = entries.filter(entry => (status === "all" || entry.status === status)
    && [entry.document.meta.title, entry.authorName, entry.notes].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  function replaceEntry(entry: GalleryPublicRecord) { setEntries(current => [entry, ...current.filter(item => item.id !== entry.id)]); }
  async function review(decision: GalleryStatus) {
    if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await galleryRequest<{ entry: GalleryPublicRecord }>("admin", { action: "review", id: selected.id, revision: selected.revision, decision, note }, undefined, true);
      replaceEntry(data.entry); setSelected(null); setNotice(t("reviewSaved"));
    } catch (cause) { setError(cause instanceof Error && cause.message === "@gallery:conflict" ? t("revisionConflict") : t("requestFailed")); }
    finally { setBusy(false); }
  }
  async function importFile(files: File[], signal: AbortSignal) {
    const file = files[0];
    if (!file || file.size > POSTER_MAX_BYTES) throw new Error(t("fileLimit"));
    const document = posterDataOnly(readPosterFile(await file.text()));
    if (!signal.aborted) setEditor({ id: `local-${crypto.randomUUID()}`, document, notes: document.meta.notes, alternatives: {}, source: "local", addedAt: Date.now() });
  }
  function saveLocal(submission: GallerySubmission) {
    const current = readGallery(localStorage.getItem(GALLERY_STORAGE_KEY));
    if (current.length >= 20) throw new Error("@gallery:full");
    const entry: GalleryEntry = { ...submission, id: `local-${crypto.randomUUID()}`, source: "local", addedAt: Date.now() };
    localStorage.setItem(GALLERY_STORAGE_KEY, JSON.stringify([entry, ...current])); setNotice(t("savedLocally"));
  }
  async function publish(submission: GallerySubmission, direct: boolean) {
    const data = await galleryRequest<{ entry: GalleryPublicRecord }>("admin", { action: "submit", submission, publish: direct, ...(editor?.source === "community" ? { id: editor.id, revision: editor.revision } : {}) }, undefined, true);
    replaceEntry(data.entry); setStatus(data.entry.status); setSelected(null); setNotice(direct ? t("adminPublished") : t("submitted"));
  }
  return <main id="admin-content" className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8" data-admin-gallery>
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-semibold">{t("adminTitle")}</h1><p className="mt-2 text-sm text-muted-foreground">{t("adminDescription")}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} />{t("refresh")}</Button><FileUploadDialog title={t("adminImport")} description={t("adminImportHint")} extensions={[".json"]} onFiles={importFile} trigger={<Button><Upload />{t("adminImport")}</Button>} /></div></header>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{(Object.keys(statuses) as GalleryStatus[]).map(key => <button key={key} aria-pressed={status === key} onClick={() => setStatus(key)} className={`rounded-lg border p-4 text-left focus-visible:ring-2 focus-visible:ring-ring ${status === key ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted"}`}><span className="block text-xs text-muted-foreground">{statuses[key]}</span><strong className="mt-2 block font-number text-3xl">{entries.filter(entry => entry.status === key).length}</strong></button>)}</div>
    <div className="flex flex-wrap items-center justify-between gap-3"><Tabs value={status} onValueChange={setStatus}><TabsList className="h-auto flex-wrap" aria-label={t("adminStatusFilter")}><TabsTrigger value="all">{t("allEntries")}</TabsTrigger>{(Object.keys(statuses) as GalleryStatus[]).map(key => <TabsTrigger key={key} value={key}>{statuses[key]}</TabsTrigger>)}</TabsList></Tabs><div className="relative w-full sm:w-80"><Search aria-hidden="true" className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input className="pl-9" aria-label={t("adminSearch")} placeholder={t("adminSearch")} value={query} onChange={event => setQuery(event.target.value)} /></div></div>
    {error && !selected && <p role="alert" className="text-sm text-destructive">{error}</p>}{notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    <section className="grid gap-3" aria-label={t("adminTitle")}>{loading ? <Skeleton className="h-40" /> : filtered.map(entry => <article key={entry.id} data-admin-gallery-entry={entry.id} className="rounded-lg border border-border bg-card p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1 space-y-2"><div className="flex flex-wrap items-center gap-2"><h2 className="break-words text-base font-semibold">{entry.document.meta.title}</h2><Badge variant="outline">{statuses[entry.status]}</Badge></div><p className="text-xs text-muted-foreground">{entry.authorName} · {entry.document.layout.template} · {t("shiftCount", { count: entry.document.draft.shifts.length })} · {new Date(entry.updatedAt).toLocaleString(locale)}</p><p className="line-clamp-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{entry.notes || entry.document.meta.instructions || t("noDescription")}</p></div><Button className="min-h-11" variant="outline" onClick={() => { setSelected(entry); setNote(entry.reviewNote ?? ""); setError(""); }}>{t("inspectReview")}</Button></div></article>)}{!loading && !filtered.length && <p className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">{t("adminEmpty")}</p>}</section>
    <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open && !busy) setSelected(null); }}><DialogContent className="flex max-h-[90svh] flex-col sm:max-w-5xl"><DialogHeader><DialogTitle>{selected?.document.meta.title ?? t("adminTitle")}</DialogTitle><DialogDescription>{t("adminReviewHint")}</DialogDescription></DialogHeader>{selected && <>
      <DialogBody className="min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] space-y-4 overflow-x-hidden overflow-y-auto"><div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm">{selected.authorName} · {statuses[selected.status]}</span><GalleryFacilityBadges document={selected.document} /></div><p className="whitespace-pre-wrap break-words rounded-lg border border-border p-3 text-sm leading-6">{selected.notes || selected.document.meta.instructions || t("noDescription")}</p>
        <Suspense fallback={<Skeleton className="aspect-video" />}><Preview document={selected.document} /></Suspense>
        <ReviewAssignments key={selected.id} entry={selected} />
        <div className="space-y-2"><h3 className="text-sm font-semibold">{t("authorBackups")}</h3>{Object.entries(selected.alternatives).filter(([, names]) => names.length).map(([name, backups]) => <div key={name} className="grid items-center gap-3 rounded-lg border border-border p-3 sm:grid-cols-[11rem_auto_minmax(0,1fr)]"><div className="min-w-0"><ReviewOperator name={name} training={selected.document.operators.find(operator => operator.name === name)} /></div><ArrowRight aria-hidden="true" className="size-4 rotate-90 justify-self-center text-muted-foreground sm:rotate-0" /><div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">{backups.map(backup => <ReviewOperator key={backup} name={backup} training={selected.authorBox?.find(operator => operator.name === backup)} />)}</div></div>)}{!Object.values(selected.alternatives).some(names => names.length) && <p className="text-xs text-muted-foreground">{t("noBackups")}</p>}</div>
        <p className="text-xs text-muted-foreground">{selected.authorBox ? t("adminBoxShared", { count: selected.authorBox.length }) : t("boxNotShared")}</p>
        <label className="grid gap-2 text-sm font-medium">{t("reviewNote")}<Textarea value={note} onChange={event => setNote(event.target.value)} maxLength={2000} rows={3} placeholder={t("rejectReason")} disabled={busy} /></label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </DialogBody><DialogFooter className="flex-wrap gap-2">{selected.isOwner && <Button variant="outline" disabled={busy} onClick={() => { setEditor({ ...selected, source: "community", addedAt: selected.createdAt }); setSelected(null); }}>{t("editSubmission")}</Button>}<Button variant="outline" disabled={busy || selected.status !== "published"} onClick={() => void review("hidden")}><EyeOff />{t("unpublish")}</Button><Button variant="outline" disabled={busy || !note.trim()} onClick={() => void review("rejected")}><X />{t("reject")}</Button><Button disabled={busy || selected.status === "published"} onClick={() => void review("published")}><Check />{t("approve")}</Button></DialogFooter>
    </>}</DialogContent></Dialog>
    {editor && <Suspense fallback={<p role="status">{t("saving")}</p>}><SubmissionDialog entry={editor} box={null} canSubmit isAdmin onClose={() => setEditor(null)} onLocalSave={saveLocal} onSubmit={publish} /></Suspense>}
  </main>;
}
