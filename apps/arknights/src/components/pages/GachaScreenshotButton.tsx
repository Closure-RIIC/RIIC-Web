"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Download, LoaderCircle, Share2 } from "lucide-react";
import { useLocale } from "use-intl";
import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
import type Messages from "../../../messages/zh-CN/AK_Raw_components_pages_GachaHistoryPage.json";
import { SetupActionButton } from "@/components/setup/SetupActionButton";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { canShareScreenshot, captureGachaScreenshot } from "@/gacha-screenshot";
import styles from "./GachaHistoryPage.module.css";

const screenshotText = createLocalizer<typeof Messages>("AK_Raw_components_pages_GachaHistoryPage");

type Screenshot = { file: File; url: string; canShare: boolean };

export function GachaScreenshotButton({ className }: { className: string }) {
  const locale = useLocale();
  const [capturing, setCapturing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<Screenshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const captureRequest = useRef(0);

  useEffect(() => () => { captureRequest.current += 1; }, []);
  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url); }, [image]);

  async function capture() {
    const request = ++captureRequest.current;
    setCapturing(true);
    setError(null);
    try {
      const file = await captureGachaScreenshot();
      if (request !== captureRequest.current) return;
      setImage({ file, url: URL.createObjectURL(file), canShare: canShareScreenshot(file) });
      setOpen(true);
    } catch {
      if (request !== captureRequest.current) return;
      setError(screenshotText.text(locale, "screenshotFailed"));
      setOpen(true);
    } finally {
      if (request === captureRequest.current) setCapturing(false);
    }
  }

  async function share() {
    if (!image || sharing) return;
    setSharing(true);
    setError(null);
    try {
      await navigator.share({ files: [image.file] });
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === "AbortError")) setError(screenshotText.text(locale, "screenshotShareFailed"));
    } finally {
      setSharing(false);
    }
  }

  return <>
    <SetupActionButton type="button" variant="outline" className={className + " " + styles.screenshotAction} data-gacha-action="screenshot" aria-label={screenshotText.text(locale, capturing ? "capturingScreenshot" : "captureScreenshot")} title={screenshotText.text(locale, "captureScreenshot")} aria-busy={capturing} disabled={capturing} onClick={() => void capture()}>
      {capturing ? <LoaderCircle className="animate-spin" /> : <Camera />}
      <span className={styles.actionLabel}>{screenshotText.text(locale, "captureScreenshot")}</span>
    </SetupActionButton>
    <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) { setImage(null); setError(null); } }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto]" data-gacha-screenshot-dialog>
        <DialogHeader>
          <DialogTitle>{screenshotText.text(locale, "saveScreenshot")}</DialogTitle>
          <DialogDescription>{screenshotText.text(locale, "screenshotDescription")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="min-h-0 overflow-y-auto">
          {image && <img src={image.url} alt={screenshotText.text(locale, "screenshotPreview")} className={styles.screenshotPreview} data-gacha-screenshot-preview />}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </DialogBody>
        {image && <DialogFooter className="flex-wrap">
          <SetupActionButton nativeButton={false} variant="outline" className="!min-w-0 flex-1" render={<a href={image.url} download={image.file.name} />}><Download />{screenshotText.text(locale, "downloadScreenshot")}</SetupActionButton>
          {image.canShare && <SetupActionButton type="button" className="!min-w-0 flex-1" disabled={sharing} aria-busy={sharing} onClick={() => void share()}><Share2 />{screenshotText.text(locale, "shareScreenshot")}</SetupActionButton>}
        </DialogFooter>}
      </DialogContent>
    </Dialog>
  </>;
}
