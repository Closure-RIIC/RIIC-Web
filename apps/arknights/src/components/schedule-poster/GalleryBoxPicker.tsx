import { useTranslations } from "use-intl";
import { Suspense, useState } from "react";
import { FolderOpen } from "lucide-react";
import { FileUploadDialog } from "@/components/FileUploadDialog";
import { Button } from "@/components/ui/button";
import type { OperBoxEntry } from "@riic/arknights-domain/types";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { lazyWithMessages } from "@/i18n/features-client";

const SklandBox = lazyWithMessages(() => import("@/components/schedule-poster/GallerySklandBox"), "apps/arknights/src/components/schedule-poster/GallerySklandBox.tsx");

export type ComparisonBoxFile = { name: string; entries: OperBoxEntry[] };

export function GalleryBoxPicker({ onSelect, nested = false }: {
  onSelect: (box: ComparisonBoxFile) => void; nested?: boolean;
}) {
  const t = useTranslations("ScheduleGallery");
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState("file");
  async function read(files: File[], signal: AbortSignal) {
    const file = files[0];
    if (!file || file.size > 10 * 1024 * 1024) throw new Error(t("comparisonFileLimit"));
    try {
      const { readOperboxFile } = await import("@riic/arknights-domain/operbox");
      const entries = await readOperboxFile(file);
      if (signal.aborted) return;
      if (!entries.length || entries.length > 1000) throw new Error("Invalid roster size");
      onSelect({ name: file.name, entries });
    } catch (cause) {
      if (signal.aborted) throw cause;
      throw new Error(t("comparisonBoxInvalid"), { cause });
    }
  }
  return <FileUploadDialog open={open} onOpenChange={setOpen} title={t("chooseComparisonBox")} description={method === "file" ? t("comparisonBoxHint") : t("scanBoxDescription")} extensions={[".json", ".xlsx", ".xls"]} layer={nested ? "nested" : "base"} onFiles={read} showUploadArea={method === "file"} contentClassName={method === "scan" ? "sm:max-w-3xl" : undefined}
    beforeUpload={<Tabs value={method} onValueChange={setMethod}><TabsList aria-label={t("boxSourceMethod")}><TabsTrigger value="file">{t("boxFileMethod")}</TabsTrigger><TabsTrigger value="scan">{t("boxScanMethod")}</TabsTrigger></TabsList></Tabs>}
    trigger={<Button variant="outline" className="min-h-11"><FolderOpen />{t("chooseComparisonBox")}</Button>}>
    {open && method === "scan" && <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">{t("loadingSklandBox")}</p>}><SklandBox onSelect={box => { onSelect(box); setOpen(false); }} /></Suspense>}
  </FileUploadDialog>;
}
