"use client";
import { adminPageClass } from "../admin-page";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonSwap } from "@/components/ui/skeleton-swap";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AppMotionProvider } from "@/components/MotionProvider";
import { ReleaseDialog } from "@/components/changelog/ReleaseDialog";
import { ReleaseEntry } from "@/components/changelog/ReleaseEntry";
import { useAdminRequest } from "../admin-context";
import type { AdminRelease, AdminReleaseList, ReleaseDraft } from "@/releases/types";
import { parseReleaseDraft } from "@/releases/validation";
import { ReleaseEditor } from "./release-editor";

function emptyDraft(): ReleaseDraft {
  return { version: "", date: new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10), title: { zh: "", en: "" }, notify: true, sections: [] };
}
type Confirmation = { action: "publish" | "withdraw" | "delete"; release: AdminRelease }
  | { action: "discard"; target: AdminRelease | null };

export function ChangelogManager() {
  const requestAdminData = useAdminRequest();
  const t = useTranslations("AdminChangelog");
  const locale = useLocale();
  const en = locale === "en";
  const [data, setData] = useState<AdminReleaseList | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AdminRelease | null>(null);
  const [draft, setDraft] = useState<ReleaseDraft>(emptyDraft);
  const [initial, setInitial] = useState(() => JSON.stringify(draft));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [preview, setPreview] = useState<{ mode: "page" | "popup"; draft: ReleaseDraft } | null>(null);
  const dirty = JSON.stringify(draft) !== initial;
  const environment = data ? t(`environment.${data.environment}`) : "";
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await requestAdminData<AdminReleaseList>("/api/admin/releases", undefined, t("loadError"))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("loadError")); }
    finally { setLoading(false); }
  }, [t, requestAdminData]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);
  function edit(record: AdminRelease | null) {
    const next = record ? structuredClone(record.draft) : emptyDraft();
    setSelected(record); setDraft(next); setInitial(JSON.stringify(next));
    setError(""); setMessage("");
  }
  function choose(record: AdminRelease | null) {
    if (dirty) setConfirmation({ action: "discard", target: record });
    else edit(record);
  }
  function updateRecord(record: AdminRelease | null, deletedId?: string) {
    setData((current) => current ? { ...current, releases: record
      ? [record, ...current.releases.filter((entry) => entry.id !== record.id)]
      : current.releases.filter((entry) => entry.id !== deletedId) } : current);
    edit(record);
  }
  async function save() {
    setError(""); setMessage("");
    let value: ReleaseDraft;
    try { value = parseReleaseDraft(draft); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("invalidContent")); return; }
    setBusy(true);
    try {
      const result = await requestAdminData<{ release: AdminRelease }>(selected ? `/api/admin/releases/${selected.id}` : "/api/admin/releases", {
        method: selected ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selected ? { action: "save", revision: selected.revision, draft: value } : value),
      }, t("saveError"));
      updateRecord(result.release);
      setMessage(t("draftSaved"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("saveFailed")); }
    finally { setBusy(false); }
  }
  async function confirmAction() {
    if (!confirmation) return;
    if (confirmation.action === "discard") { edit(confirmation.target); setConfirmation(null); return; }
    const { action, release } = confirmation;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await requestAdminData<{ release: AdminRelease | null }>(`/api/admin/releases/${release.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, revision: release.revision }),
      }, t("actionError"));
      updateRecord(result.release, release.id);
      setMessage(action === "publish" ? t("publishedMessage")
        : action === "withdraw" ? t("withdrawnMessage") : t("deletedMessage"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("actionFailed")); }
    finally { setBusy(false); setConfirmation(null); }
  }
  function showPreview(mode: "page" | "popup") {
    try { setPreview({ mode, draft: parseReleaseDraft(draft) }); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("fillRelease")); }
  }
  const filtered = data?.releases.filter((record) => `${record.draft.version} ${record.draft.title.zh} ${record.draft.title.en}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [];
  const publishChanged = selected?.published && JSON.stringify(selected.draft) !== JSON.stringify(selected.published);
  return (
    <AppMotionProvider>
      <main id="admin-content" className={adminPageClass} data-admin-changelog>
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold">{t("title")}</h1>{data ? <Badge variant="outline">{environment}</Badge> : null}</div>
            <p className="text-sm leading-6 text-muted-foreground">{t("description")}</p>
          </div>
          <Button disabled={busy || !data} onClick={() => choose(null)}>{t("newRelease")}</Button>
        </header>
        {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
        {message ? <p role="status" className="text-sm">{message}</p> : null}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(260px,1fr)_minmax(0,2fr)]">
          <section className="min-w-0 space-y-3" aria-label={t("releaseList")}>
            <div className="flex gap-2">
              <Input aria-label={t("searchReleases")} placeholder={t("searchPlaceholder")} value={query} onChange={(event) => setQuery(event.target.value)} className="h-11" />
              <Button variant="outline" className="h-11" disabled={loading || busy} onClick={() => { setError(""); void load(); }}>{t("refresh")}</Button>
            </div>
            <SkeletonSwap ready={!loading || Boolean(data)} skeleton={<Skeleton className="h-80 w-full lg:h-[640px]" />}>
            <ScrollArea className="h-80 rounded-xl border bg-background lg:h-[640px]">
              {!filtered.length ? <p className="p-5 text-sm text-muted-foreground">{t("noMatchingReleases")}</p> : filtered.map((record) => (
                <button key={record.id} disabled={busy} onClick={() => choose(record)} aria-pressed={selected?.id === record.id}
                  className="grid w-full gap-2 border-b border-border/60 p-4 text-left outline-none hover:bg-muted/60 aria-pressed:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  <span className="flex flex-wrap items-center justify-between gap-2"><span className="font-number text-lg">v{record.draft.version}</span>
                    <Badge variant={record.published ? "default" : "outline"}>{record.published ? t("published") : record.firstPublishedAt ? t("withdrawn") : t("draft")}</Badge>
                  </span>
                  <span className="break-words text-sm">{record.draft.title[en ? "en" : "zh"] || record.draft.title.zh}</span>
                  {record.published && JSON.stringify(record.draft) !== JSON.stringify(record.published) ? <span className="text-xs text-muted-foreground">{t("unpublishedChanges")}</span> : null}
                </button>
              ))}
            </ScrollArea>
            </SkeletonSwap>
          </section>
          <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="min-w-0 space-y-6 rounded-xl border bg-background p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">{selected ? t("editRelease") : t("newRelease")}</h2>
              <span className="text-xs text-muted-foreground">{dirty ? t("unsavedChanges") : publishChanged ? t("savedNotPublished") : ""}</span>
            </div>
            <ReleaseEditor draft={draft} onChange={setDraft} versionLocked={Boolean(selected?.firstPublishedAt)} disabled={busy || !data} />
            <div className="flex flex-wrap gap-2 border-t pt-5">
              <Button type="submit" disabled={busy || !data}>{busy ? t("saving") : t("saveDraft")}</Button>
              <Button type="button" variant="outline" disabled={busy || !data} onClick={() => showPreview("page")}>{t("previewPage")}</Button>
              <Button type="button" variant="outline" disabled={busy || !data} onClick={() => showPreview("popup")}>{t("previewPopup")}</Button>
            </div>
            {selected ? <div className="flex flex-wrap items-center gap-2">
              <Button type="button" disabled={busy || dirty} onClick={() => setConfirmation({ action: "publish", release: selected })}>{t("publish")}</Button>
              {selected.published ? <Button type="button" variant="outline" disabled={busy || dirty} onClick={() => setConfirmation({ action: "withdraw", release: selected })}>{t("withdraw")}</Button> : null}
              {!selected.firstPublishedAt ? <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmation({ action: "delete", release: selected })}>{t("deleteDraft")}</Button> : null}
              {dirty ? <p className="text-xs text-muted-foreground">{t("saveBeforePublishing")}</p> : null}
            </div> : null}
          </form>
        </div>
      </main>
      <Dialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open && !busy) setConfirmation(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmation?.action === "publish" ? t("publishTo", { environment })
              : confirmation?.action === "withdraw" ? t("withdrawQuestion")
              : confirmation?.action === "delete" ? t("deleteQuestion")
              : t("discardQuestion")}</DialogTitle>
            <DialogDescription>{confirmation?.action === "publish" ? t("publishDescription")
              : confirmation?.action === "withdraw" ? t("withdrawDescription")
              : t("irreversibleDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="max-sm:flex-col-reverse">
            <Button variant="outline" size="dialog" className="max-sm:w-full" disabled={busy} onClick={() => setConfirmation(null)}>{t("cancel")}</Button>
            <Button size="dialog" className="max-sm:w-full" disabled={busy} onClick={() => void confirmAction()}>{t("confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {preview?.mode === "popup" ? <ReleaseDialog release={preview.draft} open onOpenChange={(open) => { if (!open) setPreview(null); }} showHistoryLink={false} /> : null}
      <Dialog open={preview?.mode === "page"} onOpenChange={(open) => { if (!open) setPreview(null); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-[min(920px,calc(100vw-2rem))]">
          <DialogHeader><DialogTitle>{t("releasePreview")}</DialogTitle><DialogDescription>{t("previewDescription")}</DialogDescription></DialogHeader>
          <ScrollArea className="min-h-0"><DialogBody>{preview ? <ReleaseEntry release={preview.draft} latest /> : null}</DialogBody></ScrollArea>
        </DialogContent>
      </Dialog>
    </AppMotionProvider>
  );
}
