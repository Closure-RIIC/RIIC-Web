"use client";

import { useEffect, useState } from "react";
import { isBrowserReleaseUnread, markBrowserReleaseSeen, RELEASE_SEEN_EVENT, releaseSeenKey } from "@/releases/announcement-state";
import type { ReleaseDraft, ReleaseEnvironment } from "@/releases/types";
import { useReleaseFeed } from "@/releases/use-release-feed";
import { ReleaseDialog } from "./ReleaseDialog";

/** Mounted lazily by the workbench. Never interrupts another dialog or a running solve. */
export function ReleaseAnnouncement({ enabled }: { enabled: boolean }) {
  const { feed } = useReleaseFeed(true);
  const release = feed?.releases.find((entry) => entry.notify);
  return feed && release ? <Announcement key={`${feed.environment}:${release.version}`}
    enabled={enabled} latestRelease={release} environment={feed.environment} /> : null;
}

function Announcement({ enabled, latestRelease, environment }: {
  enabled: boolean; latestRelease: ReleaseDraft; environment: ReleaseEnvironment;
}) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const syncSeen = () => {
      if (isBrowserReleaseUnread(latestRelease.version, environment)) return;
      setOpen(false);
      setDismissed(true);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === releaseSeenKey(environment) || event.key === null) syncSeen();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(RELEASE_SEEN_EVENT, syncSeen);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(RELEASE_SEEN_EVENT, syncSeen);
    };
  }, [environment, latestRelease.version]);

  useEffect(() => {
    if (!enabled || dismissed || !isBrowserReleaseUnread(latestRelease.version, environment)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      // Includes nested route dialogs, mobile sidebar and dialogs still animating out.
      if (document.visibilityState !== "visible" || document.querySelector('[role="dialog"], [role="alertdialog"]')) {
        clearTimeout(timer);
        timer = undefined;
        return;
      }
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (isBrowserReleaseUnread(latestRelease.version, environment)
          && document.visibilityState === "visible"
          && !document.querySelector('[role="dialog"], [role="alertdialog"]')) setOpen(true);
      }, 1200);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["role"] });
    document.addEventListener("visibilitychange", schedule);
    schedule();
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [enabled, dismissed, environment, latestRelease.version]);

  return <ReleaseDialog release={latestRelease} open={open && enabled} onOpenChange={(next) => {
    if (next) return;
    markBrowserReleaseSeen(latestRelease.version, environment);
    setOpen(false);
    setDismissed(true);
  }} />;
}
