"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { ArrowRight, Bookmark, Check, Clock3, Download, Factory, LayoutGrid, Search, Store, SlidersHorizontal, Upload, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { FileUploadDialog } from "@/components/FileUploadDialog";
import { lazyWithMessages } from "@/i18n/features-client";
import { useRouter } from "@/navigation";
import { useWorkbench } from "@/workbench-context";
import { operatorFor } from "@/operator-catalog";
import { downloadJson } from "@/download";
import { posterDataOnly, POSTER_MAX_BYTES, readPosterFile } from "@/schedule-poster-document";
import { POSTER_HANDOFF_KEY } from "@/schedule-poster-storage";
import { filterGallery, galleryOperators, GALLERY_BOOKMARK_KEY, GALLERY_STORAGE_KEY, readGallery, type GalleryEntry } from "@/schedule-gallery";

import { galleryRequest } from "@/gallery-client";
import { applyGalleryAlternatives, operatorKey, type GalleryPublicRecord, type GallerySubmission } from "@/gallery-publishing";
import { GalleryFacilityBadges } from "@/components/schedule-poster/GalleryFacilityBadges";
import { GalleryBoxPicker, type ComparisonBoxFile } from "@/components/schedule-poster/GalleryBoxPicker";
import { GalleryBoxComparison } from "@/components/schedule-poster/GalleryBoxComparison";
const GallerySubmissionDialog = lazyWithMessages(() => import("@/components/schedule-poster/GallerySubmissionDialog"), "apps/arknights/src/components/schedule-poster/GallerySubmissionDialog.tsx");
const GalleryPreview = lazyWithMessages(() => import("@/components/schedule-poster/GalleryPreview"), "apps/arknights/src/components/schedule-poster/GalleryPreview.tsx");

export default function ScheduleGalleryPage() {
  const t = useTranslations("ScheduleGallery");
  const router = useRouter();
  const { trainingPlanner, manual } = useWorkbench();
  const [community, setCommunity] = useState<GalleryEntry[]>([]);
  const [actor, setActor] = useState<{name: string; role: "user" | "admin"} | null>(null);
  const demoRole = "";
  const [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<GalleryEntry | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [local, setLocal] = useState<GalleryEntry[]>([]);
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState("all");
  const [shifts, setShifts] = useState("all");
  const [scope, setScope] = useState("all");
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [selected, setSelected] = useState<GalleryEntry | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [opening, setOpening] = useState(false);
  const [comparisonFile, setComparisonFile] = useState<ComparisonBoxFile | null>(null);
  const comparisonBox = comparisonFile?.entries ?? trainingPlanner.operbox;
  const comparisonName = comparisonFile?.name ?? (trainingPlanner.operbox?.length ? t("currentBox") : t("noComparisonBox"));
  const owned = useMemo(() => new Set(comparisonBox?.filter(operator => operator.own).map(operatorKey) ?? []), [comparisonBox]);
  const hasBox = Boolean(comparisonBox?.length);

  useEffect(() => {
    try {
      setLocal(readGallery(localStorage.getItem(GALLERY_STORAGE_KEY)));
      const saved: unknown = JSON.parse(localStorage.getItem(GALLERY_BOOKMARK_KEY) ?? "[]");
      if (Array.isArray(saved)) setBookmarks(saved.filter((id): id is string => typeof id === "string"));
    } catch { setError(t("storageError")); }
    finally { setReady(true); }
  }, [t]);

  useEffect(() => {
    const controller = new AbortController();
    galleryRequest<{ entries: GalleryPublicRecord[]; actor: {name: string; role: "user" | "admin"} | null; demo: boolean }>(demoRole, undefined, controller.signal)
      .then(data => { if (controller.signal.aborted) return; setCommunity(data.entries.map(entry => ({ ...entry, source: "community", addedAt: entry.createdAt }))); setActor(data.actor); })
      .catch(() => { if (!controller.signal.aborted) setError(t("communityUnavailable")); });
    return () => controller.abort();
  }, [demoRole, reload, t]);
  const isAdmin = actor?.role === "admin";
  const statusLabels = { pending: t("pending"), published: t("published"), rejected: t("rejected"), hidden: t("hidden") };
  const entries = useMemo(() => [...community, ...local], [community, local]);
  const selectedDocument = useMemo(() => {
    if (!selected) return null;
    try { return applyGalleryAlternatives({ document: selected.document, notes: selected.notes ?? "", alternatives: selected.alternatives ?? {}, authorBox: selected.authorBox }, choices, comparisonBox ?? []); }
    catch { return null; }
  }, [selected, choices, comparisonBox]);
  function chooseEntry(entry: GalleryEntry) { setSelected(entry); setChoices({}); setError(""); }
  function saveLocal(submission: GallerySubmission) {
    if (!editor) return;
    if (editor.source !== "local" && local.length >= 20) throw new Error("@gallery:full");
    const entry: GalleryEntry = { ...submission, id: editor.source === "local" ? editor.id : `local-${crypto.randomUUID()}`, source: "local", addedAt: Date.now() };
    const next = [entry, ...local.filter(item => item.id !== entry.id)];
    localStorage.setItem(GALLERY_STORAGE_KEY, JSON.stringify(next)); setLocal(next); setSelected(null); setNotice(t("savedLocally"));
  }
  async function submit(submission: GallerySubmission, publish: boolean) {
    if (!editor) return;
    const data = await galleryRequest<{entry: GalleryPublicRecord}>(demoRole, {action: "submit", submission, publish, ...(editor.source === "community" ? {id: editor.id, revision: editor.revision} : {})});
    setCommunity(current => [{ ...data.entry, source: "community", addedAt: data.entry.createdAt }, ...current.filter(entry => entry.id !== data.entry.id)]); setSelected(null); setReload(value => value + 1); setScope("mine"); setNotice(t("submitted"));
  }
  const visible = filterGallery(entries, query, layout, shifts).filter(entry =>
    (scope !== "saved" || bookmarks.includes(entry.id)) && (scope !== "local" || entry.source === "local")
    && (scope !== "mine" || entry.isOwner)
    && (scope === "mine" || entry.source !== "community" || entry.status === "published")
    && (!ownedOnly || !hasBox || galleryOperators(entry.document).every(name => owned.has(operatorKey({ name })))));
  const title = (entry: GalleryEntry) => entry.source === "sample"
    ? t("sampleTitle", { layout: entry.document.layout.template, shifts: entry.document.draft.shifts.length })
    : entry.document.meta.title || t("untitled");


  function resetFilters() { setQuery(""); setLayout("all"); setShifts("all"); setOwnedOnly(false); setScope("all"); }
  function toggleBookmark(id: string) {
    const next = bookmarks.includes(id) ? bookmarks.filter(item => item !== id) : [...bookmarks, id];
    try { localStorage.setItem(GALLERY_BOOKMARK_KEY, JSON.stringify(next)); setBookmarks(next); setError(""); }
    catch { setError(t("storageError")); }
  }
  async function addFile(files: File[], signal: AbortSignal) {
    const file = files[0];
    if (!file || file.size > POSTER_MAX_BYTES) throw new Error(t("fileLimit"));
    const document = posterDataOnly(readPosterFile(await file.text()));
    if (signal.aborted) return;
    if (local.length >= 20) throw new Error(t("libraryFull"));
    if (local.some(entry => JSON.stringify(entry.document) === JSON.stringify(document))) throw new Error(t("duplicate"));
    const entry: GalleryEntry = { id: `local-${crypto.randomUUID()}`, document, notes: document.meta.notes, alternatives: {}, source: "local", addedAt: Date.now() };
    const next = [entry, ...local];
    try { localStorage.setItem(GALLERY_STORAGE_KEY, JSON.stringify(next)); }
    catch { throw new Error(t("storageError")); }
    setLocal(next); resetFilters(); setScope("local"); setNotice(t("added")); setError("");
  }
  async function openEntry(entry: GalleryEntry) {
    setOpening(true); setError("");
    try {
      const doc = applyGalleryAlternatives({document:entry.document,notes:entry.notes ?? "",alternatives:entry.alternatives ?? {},authorBox:entry.authorBox}, selected?.id === entry.id ? choices : {}, comparisonBox ?? []);
      sessionStorage.setItem(`${POSTER_HANDOFF_KEY}.manual`, JSON.stringify(doc));
      await router.push("/manual?tab=poster");
    } catch { setError(t("openError")); setOpening(false); }
  }
  function download(entry: GalleryEntry) {
    try { downloadJson(`${title(entry)}.riic.json`, selected?.id === entry.id && selectedDocument ? selectedDocument : posterDataOnly(entry.document)); }
    catch { setError(t("downloadError")); }
  }
  function remove(entry: GalleryEntry) {
    const next = local.filter(item => item.id !== entry.id);
    try { localStorage.setItem(GALLERY_STORAGE_KEY, JSON.stringify(next)); setLocal(next); setSelected(null); setNotice(t("removed")); }
    catch { setError(t("storageError")); }
  }

  return <section className="mx-auto w-full max-w-7xl space-y-4 py-3 sm:space-y-6 sm:py-5" data-schedule-gallery>
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
      <div className="space-y-3"><div className="flex items-center gap-3"><span className="rounded-lg border border-border bg-muted p-2.5"><Store className="size-6" /></span><h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1></div><p className="max-w-xl text-sm leading-6 text-muted-foreground">{t("intro")}</p></div>
      <div className="flex flex-wrap gap-2"><GalleryBoxPicker onSelect={setComparisonFile} /><FileUploadDialog title={t("addTitle")} description={t("addDescription")} extensions={[".json"]} disabled={!ready} onFiles={addFile} trigger={<Button className="min-h-11"><Upload />{t("add")}</Button>} /></div>
    </header>
    {isAdmin && <div className="flex justify-end"><Button variant="outline" render={<a href="/admin/schedule-gallery" />}>{t("adminEntry")}</Button></div>}
    <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
      <span className="flex items-center gap-2"><LayoutGrid className="size-4 text-muted-foreground" />{t("total", { count: entries.length })}</span>
      <span className="flex items-center gap-2"><Bookmark className="size-4 text-muted-foreground" />{t("savedCount", { count: entries.filter(entry => bookmarks.includes(entry.id)).length })}</span>
      <span className="text-muted-foreground">{t("communityNotice")}</span>
    </div>
    {comparisonFile && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm"><span className="min-w-0 break-all">{t("comparingBox", { name: comparisonName })}</span><Button size="sm" variant="ghost" onClick={()=>setComparisonFile(null)}>{t("useCurrentBox")}</Button></div>}
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={scope} onValueChange={setScope}><TabsList className="h-auto max-w-full flex-wrap" aria-label={t("scope")}><TabsTrigger value="all">{t("allEntries")}</TabsTrigger><TabsTrigger value="saved">{t("saved")}</TabsTrigger><TabsTrigger value="local">{t("myEntries")}</TabsTrigger>{actor && <TabsTrigger value="mine">{t("mySubmissions")}</TabsTrigger>}</TabsList></Tabs>
        <div className="relative w-full sm:w-80"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" /><Input className="h-11 pl-9" aria-label={t("search")} placeholder={t("search")} value={query} onChange={event => setQuery(event.target.value)} /></div>
      </div>
      <Button variant="outline" className="min-h-11 w-full sm:hidden" aria-expanded={filtersExpanded} onClick={() => setFiltersExpanded(value => !value)}><SlidersHorizontal />{filtersExpanded ? t("hideFilters") : t("moreFilters")}</Button>
      <div className={`${filtersExpanded ? "flex" : "hidden sm:flex"} flex-wrap items-center gap-2`} role="group" aria-label={t("layout")}><span className="mr-2 text-xs text-muted-foreground">{t("layout")}</span>{["all", "243", "252", "153", "333", "342"].map(value => <Button key={value} className="min-h-10" size="sm" variant={layout === value ? "secondary" : "ghost"} aria-pressed={layout === value} onClick={() => setLayout(value)}>{value === "all" ? t("allLayouts") : value}</Button>)}</div>
      <div className={`${filtersExpanded ? "flex" : "hidden sm:flex"} flex-wrap items-center gap-2 border-t border-border pt-3`} role="group" aria-label={t("shifts")}><span className="mr-2 text-xs text-muted-foreground">{t("shifts")}</span>{["all", "1", "2", "3", "4"].map(value => <Button key={value} size="sm" className="min-h-10" variant={shifts === value ? "secondary" : "ghost"} aria-pressed={shifts === value} onClick={() => setShifts(value)}>{value === "all" ? t("anyShifts") : t("shiftCount", { count: Number(value) })}</Button>)}<Button className="min-h-10 sm:ml-auto" size="sm" variant={ownedOnly ? "secondary" : "ghost"} disabled={!hasBox} aria-pressed={ownedOnly} onClick={() => setOwnedOnly(value => !value)}><Check className="size-4" />{hasBox ? t("ownedOnly") : t("importBox")}</Button></div>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-medium">{t("results", { count: visible.length })}</h2><Button size="sm" variant="ghost" onClick={resetFilters}><X className="size-4" />{t("reset")}</Button></div>
    {!ready ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map(id => <Skeleton key={id} className="h-72" />)}</div> : !visible.length ? <div className="grid justify-items-center gap-3 rounded-xl border border-dashed border-border px-5 py-16 text-center"><Search className="size-8 text-muted-foreground" /><h3 className="font-medium">{t("empty")}</h3><p className="text-sm text-muted-foreground">{t("emptyHint")}</p><Button variant="outline" onClick={resetFilters}>{t("reset")}</Button></div> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visible.map(entry => {
      const names = galleryOperators(entry.document);
      const doc = entry.document;
      const missingCount = names.filter(name => !owned.has(operatorKey({ name }))).length;
      return <Card key={entry.id} className="gap-0 rounded-xl border border-border py-0 ring-0 transition-colors hover:border-foreground/30" data-gallery-entry={entry.id} data-gallery-source={entry.source}>
        <div className="flex items-center justify-between gap-4 border-b border-border bg-muted/40 px-5 py-4"><div><span className="text-xs text-muted-foreground">{t("layoutLabel")}</span><div className="font-number text-4xl font-semibold tracking-tight">{doc.layout.template}</div></div><GalleryFacilityBadges document={doc} /></div>
        <CardContent className="flex flex-1 flex-col gap-4 p-5"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-words text-base font-semibold">{title(entry)}</h3><p className="mt-1 text-xs text-muted-foreground">{entry.source === "sample" ? t("sampleAuthor") : entry.authorName || doc.meta.author || t("anonymous")}</p></div><Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label={t("bookmarkLabel", { title: title(entry) })} aria-pressed={bookmarks.includes(entry.id)} onClick={() => toggleBookmark(entry.id)}><Bookmark className={bookmarks.includes(entry.id) ? "fill-current" : ""} /></Button></div>
          <div className="flex flex-wrap gap-2"><Badge variant="secondary">{entry.source === "sample" ? t("sample") : entry.status ? statusLabels[entry.status] : t("local")}</Badge><Badge variant="outline">{t("shiftCount", { count: doc.draft.shifts.length })}</Badge>{hasBox && <Badge variant="outline" className={missingCount ? "border-amber-500/40 text-amber-800 dark:text-amber-200" : "border-green-500/40 text-green-700 dark:text-green-300"}>{missingCount ? t("cardMissing", { count: missingCount }) : t("rosterMatched")}</Badge>}</div>
          <p className="line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">{entry.source === "sample" ? t("sampleDescription") : entry.notes || doc.meta.instructions || t("noDescription")}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><Clock3 className="size-3.5" />{t("cycle", { hours: doc.draft.shifts.reduce((sum, shift) => sum + shift.durationHours, 0) })}</span><span className="flex items-center gap-1.5"><Users className="size-3.5" />{t("operatorCount", { count: names.length })}</span></div>
          <div className="flex min-h-10 items-center gap-1.5" aria-label={t("includedOperators")}>{names.slice(0, 6).map(name => <img key={name} src={operatorFor(name)?.portrait} alt={name} title={name} loading="lazy" className="size-9 rounded border border-border bg-muted object-cover" />)}{names.length > 6 && <span className="ml-1 text-xs text-muted-foreground">+{names.length - 6}</span>}</div>
        </CardContent>
        <CardFooter className="gap-2 border-t border-border bg-muted/20 p-4"><Button variant="outline" className="min-h-11 flex-1" onClick={() => chooseEntry(entry)}>{t("details")}</Button><Button className="min-h-11 flex-1" disabled={opening} onClick={() => void openEntry(entry)}>{t("use")}<ArrowRight className="size-4" /></Button></CardFooter>
      </Card>;
    })}</div>}
    <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent className="flex max-h-[90svh] flex-col sm:max-w-5xl"><DialogHeader><DialogTitle>{selected ? title(selected) : t("details")}</DialogTitle><DialogDescription>{t("copyNotice")}</DialogDescription></DialogHeader>{selected && <>
      <DialogBody className="min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] space-y-5 overflow-x-hidden overflow-y-auto"><p className="rounded-lg border border-border bg-muted/40 p-3 text-sm leading-6">{selected.source === "sample" ? t("sampleWarning") : selected.notes || selected.document.meta.instructions || t("noDescription")}</p>
        <Suspense fallback={<Skeleton className="aspect-video w-full" />}><GalleryPreview document={selectedDocument ?? selected.document} /></Suspense>
        <div className="flex flex-wrap gap-4 text-sm"><span className="flex items-center gap-2"><Factory className="size-4" />{selected.document.layout.template}</span><span>{t("shiftDurations", { hours: selected.document.draft.shifts.map(shift => shift.durationHours).join(" / ") })}</span></div>
        {selected.reviewNote && <p className="rounded border border-border p-3 text-sm">{t("reviewNote")}: {selected.reviewNote}</p>}
        <GalleryBoxComparison entry={{...selected,document:selectedDocument ?? selected.document}} box={comparisonBox} boxName={comparisonName} customBox={Boolean(comparisonFile)} onSelectBox={setComparisonFile} onResetBox={()=>setComparisonFile(null)} choices={choices} onChoice={(primary,backup)=>setChoices(current=>({...current,[primary]:backup}))} onConfigure={()=>{setSelected(null);manual.onOpenSetup();}} />
        {!selectedDocument && <p role="alert" className="text-sm text-destructive">{t("backupConflict")}</p>}
      </DialogBody><DialogFooter className="flex-wrap gap-2">{(selected.source !== "community" || selected.isOwner) && <Button variant="outline" onClick={()=>{setEditor(selected);setSelected(null);}}>{t("editSubmission")}</Button>}{selected.source === "local" && <Button variant="ghost" onClick={() => remove(selected)}>{t("remove")}</Button>}<Button variant="outline" onClick={() => download(selected)}><Download />{t("download")}</Button><Button disabled={opening || !selectedDocument} onClick={() => void openEntry(selected)}>{t("use")}<ArrowRight /></Button></DialogFooter></>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</DialogContent></Dialog>
    {editor && <Suspense fallback={<p role="status">{t("saving")}</p>}><GallerySubmissionDialog entry={editor} box={trainingPlanner.operbox} canSubmit={Boolean(actor)} isAdmin={false} onClose={()=>setEditor(null)} onLocalSave={saveLocal} onSubmit={submit} /></Suspense>}
  </section>;
}
