"use client";
import { useTranslations, useLocale } from "use-intl";
import { messageRecord } from "@/i18n/translate";

import { ArrowUpRight, Code2, Database, Github, HeartHandshake, Image as ImageIcon, MessageSquareText, UsersRound, type LucideIcon } from "lucide-react";

import { InfoPageLayout } from "@/components/layout/InfoPageLayout";

type LinkCardItem = {
  title: string;
  titleKey?: "officialWebsite" | "contribute";
  zh: [string, string[]];
  en: [string, string[]];
  href: string;
  icon: LucideIcon;
};

const sources: LinkCardItem[] = [
  { title: "arknights-toolbox-data", zh: messageRecord("zh", "app_about_page_content").value as [string, string[]], en: messageRecord("en", "app_about_page_content").value as [string, string[]], href: "https://github.com/arkntools/arknights-toolbox-data", icon: Database },
  { title: "ArknightsGameResource", zh: messageRecord("zh", "app_about_page_content2").value as [string, string[]], en: messageRecord("en", "app_about_page_content2").value as [string, string[]], href: "https://github.com/yuanyan3060/ArknightsGameResource", icon: ImageIcon },
  { title: "", titleKey: "officialWebsite", zh: messageRecord("zh", "app_about_page_content3").value as [string, string[]], en: messageRecord("en", "app_about_page_content3").value as [string, string[]], href: "https://ak.hypergryph.com/", icon: Code2 },
];

const contributionCards: LinkCardItem[] = [
  { title: "RIIC-Web", zh: messageRecord("zh", "app_about_page_content4").value as [string, string[]], en: messageRecord("en", "app_about_page_content4").value as [string, string[]], href: "https://github.com/KnightCodeSquareMatrix/RIIC-Web", icon: Github },
  { title: "", titleKey: "contribute", zh: messageRecord("zh", "app_about_page_content5").value as [string, string[]], en: messageRecord("en", "app_about_page_content5").value as [string, string[]], href: "https://github.com/KnightCodeSquareMatrix/RIIC-Web/issues", icon: MessageSquareText },
];

function ResourceLink({ item, featured = false }: { item: LinkCardItem; featured?: boolean }) {
  const t = useTranslations("app_about_page");
  const Icon = item.icon;
  const locale = useLocale();
  const en = locale === "en";
  const [description, tags] = en ? item.en : item.zh;
  return (
    <a href={item.href} target="_blank" rel="noopener noreferrer" className={featured
      ? "group relative flex min-h-40 items-start gap-4 overflow-hidden bg-[#272A2B] p-5 text-white outline-none transition-[transform,box-shadow] hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[#FFD501] motion-reduce:transform-none"
      : "group flex items-start gap-3 px-2 py-5 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:gap-4 sm:px-3"}>
      {featured && <span className={`absolute inset-x-0 top-0 h-1 ${item.titleKey ? "bg-[#22BBFF]" : "bg-[#FFD800]"}`} aria-hidden="true" />}
      <Icon className={`mt-1 size-5 shrink-0 ${featured ? "text-white/64" : "text-muted-foreground"}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-3"><strong className={`min-w-0 break-words ${featured ? "text-xl font-medium" : "text-sm font-semibold"}`}>{item.titleKey ? t(item.titleKey) : item.title}</strong><ArrowUpRight className="mt-1 size-4 shrink-0 opacity-60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden="true" /></span>
        <span className={`mt-2 block text-sm leading-6 ${featured ? "text-white/64" : "text-muted-foreground"}`}>{description}</span>
        <span className={`mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs ${featured ? (item.titleKey ? "text-[#22BBFF]" : "text-[#FFD800]") : "text-muted-foreground"}`}>{tags.map((tag) => <span key={tag}>{tag}</span>)}</span>
      </span>
    </a>
  );
}

export default function AboutPage() {
  const intl = useTranslations();

  return (
    <InfoPageLayout title={intl("app_about_page.about")} href="/about" contentId="about-content">
        <article className="flex w-full flex-col gap-6 pt-5" aria-labelledby="about-title">
          <header>
            <h1 id="about-title" className="sr-only">{intl("app_about_page.about")}</h1>
            <p className="max-w-3xl text-sm leading-7 text-muted-foreground">{intl("app_about_page.closureInfrastructureTerminalIsAnUnofficialSchedulingAssistantFor")}</p>
          </header>
          <section aria-labelledby="contribution-title">
            <h2 id="contribution-title" className="mb-3 flex items-center gap-2.5 text-sm font-medium"><span className="h-5 w-1 shrink-0 bg-[#FFD501]" aria-hidden="true" />{intl("app_about_page.developmentAndContributions")}</h2>
            <div className="grid gap-3 md:grid-cols-2">{contributionCards.map((item) => <ResourceLink key={item.href} item={item} featured />)}</div>
          </section>
          <section aria-labelledby="source-title">
            <h2 id="source-title" className="mb-3 flex items-center gap-2.5 text-sm font-medium"><span className="h-5 w-1 shrink-0 bg-[#22BBFF]" aria-hidden="true" />{intl("app_about_page.developmentResourcesAndDataSources")}</h2>
            <ul className="divide-y divide-border border-y border-border">{sources.map((item) => <li key={item.href}><ResourceLink item={item} /></li>)}</ul>
          </section>
          <section aria-labelledby="support-title">
            <h2 id="support-title" className="mb-3 text-sm font-medium">{intl("app_about_page.contributorsAndSponsors")}</h2>
            <div className="grid divide-y divide-border border-y border-border md:grid-cols-2 md:divide-x md:divide-y-0">
              <div className="flex items-start gap-3 px-2 py-5 sm:px-3"><UsersRound className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" /><div className="min-w-0"><h3 className="text-sm font-semibold">{intl("app_about_page.contributors")}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{intl("app_about_page.reservedForContributorAvatarsNamesAndContributions")}</p><span className="mt-3 block text-xs text-muted-foreground">{intl("app_about_page.inProgress")}</span></div></div>
              <div className="flex items-start gap-3 px-2 py-5 sm:px-3"><HeartHandshake className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" /><div className="min-w-0"><h3 className="text-sm font-semibold">{intl("app_about_page.sponsors")}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{intl("app_about_page.reservedForSponsorNamesAvatarsAndPublicLinks")}</p><span className="mt-3 block text-xs text-muted-foreground">{intl("app_about_page.notOpenYet")}</span></div></div>
            </div>
          </section>
        </article>
    </InfoPageLayout>
  );
}
