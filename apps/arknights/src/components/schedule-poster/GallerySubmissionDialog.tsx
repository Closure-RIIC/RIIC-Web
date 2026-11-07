import { useState } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OperatorIdentity, OperatorSearch } from "@/components/operators/OperatorPickerParts";
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem } from "@/components/ui/combobox";
import { OPERATOR_CATALOG } from "@/operator-catalog";
import type { OperBoxEntry } from "@riic/arknights-domain/types";
import { galleryOperators, type GalleryEntry } from "@/schedule-gallery";
import { parseGallerySubmission, type GallerySubmission } from "@/gallery-publishing";

export default function GallerySubmissionDialog({ entry, box, canSubmit, isAdmin, onClose, onLocalSave, onSubmit }: {
  entry: GalleryEntry; box: OperBoxEntry[] | null; canSubmit: boolean; isAdmin: boolean;
  onClose: () => void; onLocalSave: (submission: GallerySubmission) => void;
  onSubmit: (submission: GallerySubmission, publish: boolean) => Promise<void>;
}) {
  const t = useTranslations("ScheduleGallery");
  const [title, setTitle] = useState(entry.document.meta.title);
  const [notes, setNotes] = useState(entry.notes ?? entry.document.meta.notes);
  const [alternatives, setAlternatives] = useState<Record<string, string[]>>(entry.alternatives ?? {});
  const primaries = galleryOperators(entry.document).filter(name => name !== "菲亚梅塔" || !entry.document.draft.fiammettaEnabled);
  const [primary, setPrimary] = useState<string | null>(primaries[0] ?? null);
  const [query, setQuery] = useState("");
  const [shareBox, setShareBox] = useState(Boolean(entry.authorBox));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const backups = primary ? alternatives[primary] ?? [] : [];
  const candidates = OPERATOR_CATALOG.filter(operator => operator.name !== primary && (!query.trim() || operator.name.toLowerCase().includes(query.trim().toLowerCase()))).slice(0, 24);
  function toggle(name: string) {
    if (!primary) return;
    const next = backups.includes(name) ? backups.filter(item => item !== name) : [...backups, name];
    if (next.length > 5) { setError(t("backupLimit")); return; }
    setAlternatives(current => ({ ...current, [primary]: next })); setError("");
  }
  async function save(mode: "local" | "submit" | "publish") {
    setBusy(true); setError("");
    try {
      const submission = parseGallerySubmission({ document: { ...entry.document, meta: { ...entry.document.meta, title: title.trim() } }, notes, alternatives, ...(shareBox ? { authorBox: box?.length ? box : entry.authorBox } : {}) });
      if (mode === "local") onLocalSave(submission); else await onSubmit(submission, mode === "publish");
      onClose();
    } catch (cause) { setError(cause instanceof Error && cause.message.startsWith("@gallery:") ? t("requestFailed") : t("submissionInvalid")); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="flex max-h-[90svh] flex-col sm:max-w-3xl"><DialogHeader><DialogTitle>{t("editSubmission")}</DialogTitle><DialogDescription>{t("reviewFlow")}</DialogDescription></DialogHeader>
    <DialogBody className="min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] space-y-5 overflow-x-hidden overflow-y-auto">
      <label className="grid gap-2 text-sm">{t("submissionTitle")}<Input value={title} onChange={event => setTitle(event.target.value)} maxLength={40} disabled={busy} /></label>
      <label className="grid gap-2 text-sm">{t("authorNotes")}<Textarea aria-label={t("authorNotes")} value={notes} onChange={event => setNotes(event.target.value)} maxLength={2000} rows={4} disabled={busy} placeholder={t("notesPlaceholder")} /><span className="text-right text-xs text-muted-foreground">{notes.length}/2000</span></label>
      <div className="space-y-3 rounded-lg border border-border p-4"><h3 className="font-medium">{t("authorBackups")}</h3><p className="text-xs leading-5 text-muted-foreground">{t("backupHint")}</p>
        <Combobox items={primaries} value={primary} onValueChange={value => { setPrimary(value); setQuery(""); }}><ComboboxInput aria-label={t("primaryOperator")} placeholder={t("primaryOperator")} disabled={busy} /><ComboboxContent><ComboboxList>{name => <ComboboxItem key={name} value={name}>{name}</ComboboxItem>}</ComboboxList></ComboboxContent></Combobox>
        <div className="flex min-h-8 flex-wrap gap-2">{backups.map(name => <Button size="sm" variant="secondary" key={name} onClick={() => toggle(name)} disabled={busy}>{name} ×</Button>)}{!backups.length && <span className="text-xs text-muted-foreground">{t("noBackups")}</span>}</div>
        <OperatorSearch value={query} onChange={setQuery} label={t("searchBackup")} />
        <div className="grid max-h-64 grid-cols-2 gap-2 overflow-auto">{candidates.map(operator => <button type="button" key={operator.id} disabled={busy || !primary} aria-pressed={backups.includes(operator.name)} onClick={() => toggle(operator.name)} className={`flex min-h-14 items-center gap-2 rounded-lg border p-2 text-left focus-visible:ring-2 focus-visible:ring-ring ${backups.includes(operator.name) ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}><OperatorIdentity name={operator.name} portrait={operator.portrait} compact><Badge variant="outline">{operator.rarity}★</Badge></OperatorIdentity></button>)}</div>
      </div>
      <label className="flex items-start gap-3 rounded-lg border border-border p-4"><Switch checked={shareBox} onCheckedChange={setShareBox} disabled={busy || (!box?.length && !entry.authorBox)} /><span className="space-y-1 text-sm"><span className="block font-medium">{t("shareAuthorBox")}</span><span className="block text-xs leading-5 text-muted-foreground">{t("shareBoxHint")}</span></span></label>
      {!canSubmit && <p className="text-sm text-muted-foreground">{t("signInSubmit")}</p>}
      {entry.source === "community" && <p className="text-xs text-muted-foreground">{t("editRequiresReview")}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </DialogBody><DialogFooter className="flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void save("local")}>{t("saveLocally")}</Button><Button disabled={busy || !canSubmit} onClick={() => void save("submit")}>{busy ? t("saving") : t("submitReview")}</Button>{isAdmin && <Button disabled={busy} onClick={() => void save("publish")}>{t("publishNow")}</Button>}</DialogFooter>
  </DialogContent></Dialog>;
}
