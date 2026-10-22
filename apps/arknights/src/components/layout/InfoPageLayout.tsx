"use client";

import { Link } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import type { ReactNode } from "react";
import { LanguageSwitch } from "@/i18n/client";
import { FilingLinks } from "@riic/shell/FilingLinks";

/** Shared public-document shell for help and legal pages. */
export function InfoPageLayout({ title, href, contentId, children, floatingControls }: {
  title: string;
  href: string;
  contentId: string;
  children: ReactNode;
  floatingControls?: ReactNode;
}) {
  const t = useTranslations("InfoPageLayout");
  const navigation = useTranslations("App");
  return (
    <main className="flex min-h-dvh flex-col bg-background text-foreground">
      <a href={`#${contentId}`} className="sr-only z-50 bg-background px-4 py-3 font-medium focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:ring-2 focus:ring-ring">
        {t("skipToContent")}
      </a>
      <header className="border-b border-border/80 bg-background">
        <div className="app-content-track flex min-h-14 items-center justify-between gap-4">
          <Link className="inline-flex min-h-11 items-center gap-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring" to={href}>
            <span className="h-5 w-1 shrink-0 bg-[#FFD501]" aria-hidden="true" />
            <span className="text-sm font-semibold">{title}</span>
          </Link>
          <div className="flex items-center gap-3">
            <LanguageSwitch />
            <Link className="inline-flex min-h-11 items-center text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" to="/">
              {t("backToCalculator")}
            </Link>
          </div>
        </div>
      </header>
      <div className="app-content-track flex-1 pb-8 sm:pb-10">
        <div id={contentId} className="min-w-0" tabIndex={-1}>{children}</div>
      </div>
      <footer
        className="app-content-track flex flex-wrap items-center gap-x-4 border-t border-border/80 py-5 text-xs text-muted-foreground"
        style={floatingControls ? { paddingInlineEnd: "max(6rem, env(safe-area-inset-right))" } : undefined}
      >
        <Link className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground" to="/changelog">{t("changelog")}</Link>
        <Link className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground" to="/terms">{t("terms")}</Link>
        <Link className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground" to="/privacy">{t("privacy")}</Link>
        <span className="inline-flex items-center gap-x-4">
          <Link className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground" to="/about">{t("about")}</Link>
          <Link preload={false} className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground" to="/wishes" data-wishes-link>{navigation("wishes")}</Link>
        </span>
        <div className="ml-auto min-w-0 max-sm:ml-0 max-sm:w-full"><FilingLinks /></div>
      </footer>
      {floatingControls}
    </main>
  );
}
