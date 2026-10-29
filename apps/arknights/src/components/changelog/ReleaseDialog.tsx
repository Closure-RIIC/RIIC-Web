"use client";

import { releaseText } from "@riic/arknights-domain/releases/types";
import { Link } from "@tanstack/react-router";
import { useLocale, useTranslations } from "use-intl";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ReleaseNote } from "@riic/arknights-domain/releases/types";
import { ReleaseNotes } from "./ReleaseNotes";

export function ReleaseDialog({ open, onOpenChange, release: latestRelease, showHistoryLink = true }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showHistoryLink?: boolean;
  release: ReleaseNote;
}) {
  const t = useTranslations("ReleaseDialog");
  const locale = useLocale();
  const en = locale;
  const dismissRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-[min(600px,calc(100vw-2rem))]"
        data-release-dialog
        aria-label={t("ariaLabel", { version: latestRelease.version })}
        initialFocus={dismissRef}
      >
        <DialogHeader>
          <DialogTitle>{t("whatsNew")} <span className="font-number">v{latestRelease.version}</span></DialogTitle>
          <DialogDescription>
            {releaseText(latestRelease.title, en)} · <time dateTime={latestRelease.date} className="font-number">{latestRelease.date}</time>
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0" viewportClassName="overscroll-contain">
          <DialogBody><ReleaseNotes release={latestRelease} /></DialogBody>
        </ScrollArea>
        <DialogFooter className="max-sm:flex-col-reverse">
          {showHistoryLink ? (
            <Button variant="outline" size="dialog" nativeButton={false}
              className="max-sm:w-full"
              render={<Link preload={false} to="/changelog" hash={"v" + latestRelease.version} />}
              onClick={() => onOpenChange(false)}>
              {t("fullChangelog")}
            </Button>
          ) : null}
          <Button ref={dismissRef} size="dialog" className="max-sm:w-full" onClick={() => onOpenChange(false)}>
            {t("gotIt")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
