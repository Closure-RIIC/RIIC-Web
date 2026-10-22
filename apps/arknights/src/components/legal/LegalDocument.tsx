"use client";
import { useTranslations } from "use-intl";

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { LanguageSwitch } from "@/i18n/client";

export function LegalDocument({
  eyebrow,
  title,
  effectiveDate,
  children,
}: {
  eyebrow: string;
  title: string;
  effectiveDate: string;
  children: ReactNode;
}) {
  const intl = useTranslations();
  return (
    <main className="min-h-dvh bg-background px-5 py-10 text-foreground sm:px-8 sm:py-14">
      <article className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between gap-4"><Link className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground" to="/">{intl("components_legal_LegalDocument.backToClosureInfrastructureTerminal")}</Link><LanguageSwitch /></div>
        <header className="mt-8 border-b border-border pb-7">
          <p className="text-xs font-medium tracking-wide text-primary">{eyebrow}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {intl("components_legal_LegalDocument.versionAndEffectiveDate")}<span className="font-number">{effectiveDate}</span>
          </p>
        </header>
        <div className="prose prose-neutral mt-8 max-w-none space-y-8 text-sm leading-7 dark:prose-invert [&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mb-3 [&_h2]:mt-0 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_li]:my-1 [&_p]:my-2">
          {children}
        </div>
      </article>
      <footer className="mx-auto mt-10 flex max-w-3xl flex-wrap items-center gap-x-4 border-t border-border pt-5 text-xs text-muted-foreground">
        <Link className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground" to="/terms">
          {intl("components_legal_LegalDocument.termsOfService")}
        </Link>
        <Link className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground" to="/privacy">
          {intl("components_legal_LegalDocument.privacyPolicy")}
        </Link>
        <span className="inline-flex items-center gap-x-4">
          <Link className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground" to="/about">
            {intl("components_legal_LegalDocument.about")}
          </Link>
          <Link preload={false} className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground" to="/wishes" data-wishes-link>
            {intl("App.wishes")}
          </Link>
        </span>
      </footer>
    </main>
  );
}
