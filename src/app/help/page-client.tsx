"use client";
import { useTranslations, useLocale } from "use-intl";
import { messageRecord } from "@/i18n/translate";

import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

const quickChecks = [
  {
    zh: messageRecord("zh", "app_help_page_content").value as [string, string],
    en: messageRecord("en", "app_help_page_content").value as [string, string],
    href: "/help/owned-operators?issue=unexpected-operators",
  },
  {
    zh: messageRecord("zh", "app_help_page_content2").value as [string, string],
    en: messageRecord("en", "app_help_page_content2").value as [string, string],
    href: "/help/owned-operators?issue=saved-box",
  },
  {
    zh: messageRecord("zh", "app_help_page_content3").value as [string, string],
    en: messageRecord("en", "app_help_page_content3").value as [string, string],
    href: "/help/owned-operators?issue=box-not-applied",
  },
  {
    zh: messageRecord("zh", "app_help_page_content4").value as [string, string],
    en: messageRecord("en", "app_help_page_content4").value as [string, string],
    href: "/help/owned-operators?issue=busy",
  },
];

export default function HelpHomePage() {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale === "en";
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
        <span className="min-w-0"><strong className="block text-lg font-semibold">{en ? "Beginner tutorials" : "新手教程"}</strong><span className="mt-2 block text-sm leading-6 text-muted-foreground">{en ? "Video tutorials for MAA Box export, manual scheduling, shift changes, and Orundum production." : "MAA 获取 Box、手动抄作业、换班与搓玉视频教程。"}</span></span>
        <ArrowRight className="size-5 shrink-0 transition-transform group-hover:translate-x-1" aria-hidden="true" />
      </Link>

      <section aria-labelledby="quick-check-title">
        <div className="mb-2 flex min-w-0 items-center gap-2.5">
          <span className="h-5 w-1 shrink-0 bg-[#22BBFF]" aria-hidden="true" />
          <h2 id="quick-check-title" className="text-sm font-medium text-[#313131]">{intl("app_help_page.30SecondCheck")}</h2>
        </div>
        <ol className="divide-y divide-border border-y border-border">
          {quickChecks.map((item, index) => {
            const [title, description] = en ? item.en : item.zh;
            return <li key={item.href}>
              <Link
                to={item.href}
                data-quick-check-link
                className="group grid min-h-24 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-2 py-4 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-3"
                aria-labelledby={`quick-check-${index}`}
              >
                <span className="font-number text-sm text-[#313131]/38">{String(index + 1).padStart(2, "0")}</span>
                <span className="min-w-0">
                  <strong id={`quick-check-${index}`} className="block text-sm font-semibold">{title}</strong>
                  <span className="mt-1 block text-sm leading-6 text-muted-foreground">{description}</span>
                </span>
                <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 motion-reduce:transform-none" aria-hidden="true" />
              </Link>
            </li>;
          })}
        </ol>
      </section>

      <section className="border-t border-border pt-5" aria-labelledby="more-help-title">
        <h2 id="more-help-title" className="text-sm font-semibold">{intl("app_help_page.stillNotWorking")}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{intl("app_help_page.recordTheCurrentBoxSourceOwnedOperatorCountBase")}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link className="inline-flex min-h-10 items-center rounded-[4px] bg-foreground px-3 text-sm font-medium text-background outline-none hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring" to="/">{intl("app_help_page.checkTheCalculator")}</Link>
          <a className="inline-flex min-h-10 items-center rounded-[4px] border border-border px-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" href="https://github.com/KnightCodeSquareMatrix/RIIC-Web/issues" target="_blank" rel="noreferrer">{intl("app_help_page.reportAnIssue")}</a>
        </div>
      </section>
    </article>
  );
}
