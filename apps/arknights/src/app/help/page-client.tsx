"use client";

import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../messages/zh-CN/AK_app_help_page_client.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_app_help_page_client");

import { useTranslations, useLocale } from "use-intl";

import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { KnowledgeHelpSection } from "@/components/help/KnowledgeHelpSection";

export default function HelpHomePage() {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale;
  return (
    <article className="flex w-full flex-col gap-5 pt-5">
      <section className="grid gap-3 md:grid-cols-2" aria-label={intl("app_help_page.helpTopics")}>
        <Link
          to="/help/import-operators"
          className="group relative min-h-40 overflow-hidden bg-[#272A2B] p-5 text-white outline-none transition-[transform,box-shadow] hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[#FFD501] motion-reduce:transform-none"
        >
          <span className="absolute inset-x-0 top-0 h-1 bg-[#FFD800]" aria-hidden="true" />
          <span className="text-xs text-white/48">{intl("app_help_page.firstImport")}</span>
          <strong className="mt-3 block max-w-xl text-xl font-medium">{intl("app_help_page.importYourOperatorBoxStepByStep")}</strong>
          <span className="mt-8 inline-flex min-h-11 items-center gap-2 text-sm text-[#FFD800]">
            {intl("app_help_page.openTutorial")}<ArrowRight className="size-4 transition-transform group-hover:translate-x-1 motion-reduce:transform-none" aria-hidden="true" />
          </span>
        </Link>
        <Link
          to="/help/owned-operators" search={{ issue: "unexpected-operators" }}
          className="group relative min-h-40 overflow-hidden bg-[#272A2B] p-5 text-white outline-none transition-[transform,box-shadow] hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[#22BBFF] motion-reduce:transform-none"
        >
          <span className="absolute inset-x-0 top-0 h-1 bg-[#22BBFF]" aria-hidden="true" />
          <span className="text-xs text-white/48">{intl("app_help_page.commonIssue")}</span>
          <strong className="mt-3 block max-w-xl text-xl font-medium">{intl("app_help_page.switchToTheOperatorsYouActuallyOwn")}</strong>
          <span className="mt-8 inline-flex min-h-11 items-center gap-2 text-sm text-[#22BBFF]">
            {intl("app_help_page.viewSteps")}<ArrowRight className="size-4 transition-transform group-hover:translate-x-1 motion-reduce:transform-none" aria-hidden="true" />
          </span>
        </Link>
      </section>

      <Link to="/help/beginner" className="group flex min-h-28 scroll-mt-5 items-center justify-between gap-4 border-y border-border px-3 py-5 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring sm:px-5">
        <span className="min-w-0"><strong className="block text-lg font-semibold">{uiText.text(en, "beginnerTutorials")}</strong><span className="mt-2 block text-sm leading-6 text-muted-foreground">{uiText.text(en, "videoTutorialsForMaaBoxExportManualScheduling")}</span></span>
        <ArrowRight className="size-5 shrink-0 transition-transform group-hover:translate-x-1" aria-hidden="true" />
      </Link>

      <KnowledgeHelpSection />

      <section className="border-t border-border pt-5" aria-labelledby="more-help-title">
        <h2 id="more-help-title" className="text-sm font-semibold">{intl("app_help_page.stillNotWorking")}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{intl("app_help_page.recordTheCurrentBoxSourceOwnedOperatorCountBase")}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link className="inline-flex min-h-10 items-center rounded-[4px] bg-foreground px-3 text-sm font-medium text-background outline-none hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring" to="/">{intl("app_help_page.checkTheCalculator")}</Link>
          <a className="inline-flex min-h-10 items-center rounded-[4px] border border-border px-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" href="https://github.com/Closure-RIIC/RIIC-Web/issues" target="_blank" rel="noreferrer">{intl("app_help_page.reportAnIssue")}</a>
        </div>
      </section>
    </article>
  );
}
