"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { InfoPageLayout } from "@/components/layout/InfoPageLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonSwap } from "@/components/ui/skeleton-swap";
import { AppMotionProvider } from "@/components/MotionProvider";
import { markBrowserReleaseSeen } from "@/releases/announcement-state";
import { useReleaseFeed } from "@/releases/use-release-feed";
import { ReleaseEntry } from "./ReleaseEntry";

const ReleaseDialog = lazy(() => import("./ReleaseDialog").then((module) => ({ default: module.ReleaseDialog })));

export function ChangelogPage() {
  const t = useTranslations("ChangelogPage");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMounted, setDialogMounted] = useState(false);
  const { feed, loading, error, refresh } = useReleaseFeed();
  const releaseHistory = feed?.releases ?? [];
  const latest = releaseHistory[0];
  const followedAnchor = useRef(false);
  useEffect(() => {
    if (latest && feed) markBrowserReleaseSeen(latest.version, feed.environment);
  }, [latest, feed]);
  useEffect(() => {
    if (!feed || followedAnchor.current) return;
    followedAnchor.current = true;
    const anchor = window.location.hash.slice(1);
    if (/^v\d+\.\d+\.\d+$/.test(anchor)) document.getElementById(anchor)?.scrollIntoView();
  }, [feed]);

  return (
    <AppMotionProvider>
      <InfoPageLayout title={t("title")} href="/changelog" contentId="changelog-content">
        <div className="mx-auto max-w-4xl" data-changelog-page>
          <header className="flex flex-wrap items-end justify-between gap-5 border-b border-border/80 py-8 sm:py-12">
            <div className="space-y-3">
              <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">{t("title")}</h1>
              <p className="text-sm leading-6 text-muted-foreground">{t("description")}</p>
            </div>
            <Button variant="outline" className="h-11 px-4 text-[13px]" aria-haspopup="dialog" disabled={!latest}
              onClick={() => { setDialogMounted(true); setDialogOpen(true); }}>
              {t("latestUpdate")}
            </Button>
          </header>
          <SkeletonSwap ready={!loading || Boolean(feed)} skeleton={<div className="space-y-5 py-8" role="status" aria-label={t("loading")}>
            <Skeleton className="h-8 w-40" /><Skeleton className="h-32 w-full" />
          </div>}>
          {error ? <div role="alert" className="space-y-4 py-8">
            <p>{t("loadError")}</p>
            <Button variant="outline" onClick={() => void refresh()}>{t("retry")}</Button>
          </div> : !releaseHistory.length ? <p className="py-10 text-sm text-muted-foreground">{t("empty")}</p> : null}
          {releaseHistory.map((release, index) => <ReleaseEntry key={release.version} release={release} latest={index === 0} />)}
          </SkeletonSwap>
          <p className="py-7 text-sm leading-7 text-muted-foreground">
            {t("earlier")}{" "}
            <a className="rounded-sm text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href="https://github.com/KnightCodeSquareMatrix/RIIC-Web/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">
              {t("repositoryLink")}
            </a>
          </p>
        </div>
      </InfoPageLayout>
      {dialogMounted && latest ? <Suspense fallback={null}><ReleaseDialog release={latest} open={dialogOpen} onOpenChange={setDialogOpen} showHistoryLink={false} /></Suspense> : null}
    </AppMotionProvider>
  );
}
