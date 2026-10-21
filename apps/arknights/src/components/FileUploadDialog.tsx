"use client";

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { Loader2, Upload } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type FileUploadDialogProps = {
  title: string;
  description?: string;
  extensions: string[];
  trigger: ReactElement;
  multiple?: boolean;
  maxFiles?: number;
  disabled?: boolean;
  layer?: "base" | "nested";
  children?: ReactNode;
  returnFocus?: () => HTMLElement | null;
  successFocus?: () => HTMLElement | false;
  onFiles: (files: File[], signal: AbortSignal) => void | Promise<void>;
};

export function FileUploadDialog({
  title, description, extensions, trigger, multiple = false, maxFiles,
  disabled = false, layer = "base", children, returnFocus, successFocus, onFiles,
}: FileUploadDialogProps) {
  const t = useTranslations("FileUpload");
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const operation = useRef<AbortController | null>(null);
  const succeeded = useRef(false);
  const dragDepth = useRef(0);
  const formats = extensions.join(" / ");

  useEffect(() => () => { operation.current?.abort(); }, []);

  useEffect(() => {
    if (!open) return;
    // A file dropped on the overlay must not navigate away from the application.
    const preventFileNavigation = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", preventFileNavigation);
    window.addEventListener("drop", preventFileNavigation);
    return () => {
      window.removeEventListener("dragover", preventFileNavigation);
      window.removeEventListener("drop", preventFileNavigation);
    };
  }, [open]);

  function changeOpen(next: boolean) {
    operation.current?.abort();
    operation.current = null;
    dragDepth.current = 0;
    setDragging(false);
    setBusy(false);
    if (next) {
      succeeded.current = false;
      setError(null);
    }
    setOpen(next);
  }

  async function selectFiles(files: File[]) {
    if (!files.length || operation.current || disabled) return;
    dragDepth.current = 0;
    setDragging(false);
    if (!multiple && files.length > 1) {
      setError(t("singleFileOnly"));
      return;
    }
    if (maxFiles !== undefined && files.length > maxFiles) {
      setError(t("tooManyFiles", { count: maxFiles }));
      return;
    }
    const unsupported = files.find(file => !extensions.some(extension => file.name.toLowerCase().endsWith(extension.toLowerCase())));
    if (unsupported) {
      setError(t("unsupportedFile", { name: unsupported.name, formats }));
      return;
    }

    const current = new AbortController();
    operation.current = current;
    setError(null);
    setBusy(true);
    try {
      await onFiles(files, current.signal);
      if (current.signal.aborted || operation.current !== current) return;
      succeeded.current = true;
      setOpen(false);
    } catch (cause) {
      if (!current.signal.aborted && operation.current === current) {
        setError(cause instanceof Error ? cause.message : t("readFailed"));
      }
    } finally {
      if (operation.current === current && !current.signal.aborted) {
        operation.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger render={trigger} disabled={disabled} />
      <DialogContent
        data-file-upload-dialog
        layer={layer}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        finalFocus={() => succeeded.current && successFocus ? successFocus() : returnFocus?.() ?? true}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogBody>
          <div
            data-file-dropzone
            data-dragging={dragging || undefined}
            aria-busy={busy}
            className={cn(
              "flex min-h-44 flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-background px-4 py-6 text-center transition-colors",
              dragging && "border-primary bg-primary/10 ring-2 ring-primary/25",
            )}
            onDragEnter={event => {
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              dragDepth.current += 1;
              if (!operation.current) setDragging(true);
            }}
            onDragOver={event => {
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = busy ? "none" : "copy";
            }}
            onDragLeave={() => {
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (!dragDepth.current) setDragging(false);
            }}
            onDrop={event => {
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              event.stopPropagation();
              void selectFiles(Array.from(event.dataTransfer.files));
            }}
          >
            {busy ? <Loader2 className="size-6 motion-safe:animate-spin" aria-hidden="true" /> : <Upload className="size-6 text-primary" aria-hidden="true" />}
            <p role="status" className="font-medium">{busy ? t("processing") : dragging ? t("dropNow") : t("dropOrChoose")}</p>
            <p className="text-xs text-muted-foreground">{t(multiple ? "multipleFiles" : "singleFile", { formats })}</p>
            <Button type="button" variant="outline" disabled={busy} onClick={() => input.current?.click()}>{t("chooseFiles")}</Button>
            <input
              ref={input}
              type="file"
              className="hidden"
              accept={extensions.join(",")}
              multiple={multiple}
              disabled={busy || disabled}
              onChange={event => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                void selectFiles(files);
              }}
            />
          </div>
          {children}
          {error && <Alert variant="destructive"><AlertDescription className="break-words [overflow-wrap:anywhere]">{error}</AlertDescription></Alert>}
        </DialogBody>
        <DialogFooter><Button type="button" variant="ghost" onClick={() => changeOpen(false)}>{t("cancel")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
