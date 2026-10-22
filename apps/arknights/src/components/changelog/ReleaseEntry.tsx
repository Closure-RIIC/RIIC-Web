"use client";

import { Badge } from "@/components/ui/badge";
import { useLocale, useTranslations } from "use-intl";
import type { ReleaseNote } from "@riic/arknights-domain/releases/types";
import { ReleaseNotes } from "./ReleaseNotes";

/** The same version entry is rendered publicly and in the administrator's preview. */
export function ReleaseEntry({ release, latest = false }: { release: ReleaseNote; latest?: boolean }) {
  const t = useTranslations("ReleaseEntry");
  const locale = useLocale();
  const en = locale === "en";
  return (
    <article id={`v${release.version}`} aria-labelledby={`release-${release.version}`}
      className="grid scroll-mt-6 gap-5 border-b border-border/70 py-8 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-9 sm:py-10">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 self-start sm:grid">
        <a href={`#v${release.version}`} className="w-fit rounded-sm font-number text-2xl leading-none outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("linkToVersion", { version: release.version })}>v{release.version}</a>
        <time dateTime={release.date} className="font-number text-sm text-muted-foreground">{release.date}</time>
        {latest ? <Badge>{t("latest")}</Badge> : null}
      </div>
      <div className="min-w-0 space-y-5">
        <h2 id={`release-${release.version}`} className="break-words font-heading text-xl font-semibold leading-8">{release.title[en ? "en" : "zh"] || release.title.zh}</h2>
        <ReleaseNotes release={release} />
      </div>
    </article>
  );
}
