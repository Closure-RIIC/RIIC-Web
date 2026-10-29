"use client";

import { lazyWithMessages } from "@/i18n/features-client";
import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../messages/zh-CN/AK_components_docs_DocsContent.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_components_docs_DocsContent");


import { Suspense, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, Copy, FileInput, Lightbulb, Play, ArrowUpRight } from "lucide-react";
import { useLocale } from "use-intl";
import { DOC_ARTICLES, DOC_GROUPS, docText, findDoc, type DocArticle } from "@/docs/content";
import { KNOWLEDGE_FAQS, KNOWLEDGE_REPOSITORY, knowledgeSourceUrl } from "@/help-knowledge";
import { helpKnowledgeText } from "@/i18n/helpers/help_knowledge";
import { FilingLinks } from "@/components/layout/FilingLinks";
import { guidePages } from "@/app/help/import-operators/page-client";
import { DocsBackToTop, DocsTableOfContents } from "./DocsLayout";
import styles from "./DocsLayout.module.css";

const VideoTutorials = lazyWithMessages(() => import("@/app/help/beginner/page-client"), "apps/arknights/src/app/help/beginner/page-client.tsx");

function DocsFooter() {
  const en = useLocale();
  return <footer className={styles.footer}><span>{uiText.text(en, "closureInfrastructureTerminal")}</span><DocsBackToTop /><Link to="/privacy">{uiText.text(en, "privacy")}</Link><Link to="/terms">{uiText.text(en, "terms")}</Link><FilingLinks /></footer>;
}

function ArticleLinks({ articles }: { articles: DocArticle[] }) {
  const locale = useLocale();
  return <div className={styles.articleList}>{articles.map(article => <Link key={article.slug} to="/docs/$slug" params={{ slug: article.slug }}><span>{docText(article.title, locale)}</span><ArrowRight size={14} aria-hidden="true" /></Link>)}</div>;
}

export function DocsHome() {
  const locale = useLocale();
  const en = locale;
  const popular = [
    { article: findDoc("maa-import")!, icon: FileInput },
    { article: findDoc("faq")!, icon: Lightbulb },
    { article: findDoc("video-tutorials")!, icon: Play },
  ];
  return <div className={styles.home} id="docs-content" tabIndex={-1} data-docs-home>
    <p className={styles.eyebrow}>{uiText.text(en, "closureDocumentation")}</p>
    <h1>{uiText.text(en, "makeYourselfAtHome")}</h1>
    <p className={styles.intro}>{uiText.text(en, "importYourOperatorsBuildAScheduleAndFind")}</p>
    <Link to="/docs/$slug" params={{ slug: "first-import" }} className={styles.start}>
      <div><small>{uiText.text(en, "newToTheTerminal")}</small><strong>{uiText.text(en, "startWithYourFirstImport")}</strong><p>{uiText.text(en, "chooseSklandOrMaaWeLlWalkYou")}</p></div><span className={styles.startIcon}><ArrowRight size={20} aria-hidden="true" /></span>
    </Link>
    <section className={styles.homeSection} aria-labelledby="docs-popular"><h2 id="docs-popular" className={styles.sectionHeading}>{uiText.text(en, "quickLinks")}</h2><div className={styles.popular}>{popular.map(({ article, icon: Icon }) => <Link key={article.slug} to="/docs/$slug" params={{ slug: article.slug }}><Icon size={20} aria-hidden="true" /><strong>{docText(article.title, locale)}</strong><p>{docText(article.description, locale)}</p></Link>)}</div></section>
    <div className={styles.categories}>{DOC_GROUPS.map(group => <section key={group.id} className={styles.category}>
      <h2>{docText(group.title, locale)}</h2><p>{docText(group.description, locale)}</p><ArticleLinks articles={DOC_ARTICLES.filter(article => article.group === group.id)} />
    </section>)}</div>
    <DocsFooter />
  </div>;
}

function CopyLink() {
  const en = useLocale();
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  return <button type="button" className={styles.copyButton} onClick={async () => {
    try { await navigator.clipboard.writeText(window.location.href); setState("copied"); } catch { setState("error"); }
  }}>{state === "copied" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}<span role="status">{state === "copied" ? (uiText.text(en, "linkCopied")) : state === "error" ? (uiText.text(en, "copyTheAddressFromYourBrowser")) : (uiText.text(en, "copyLink"))}</span></button>;
}

export function DocsArticlePage() {
  const { slug } = useParams({ from: "/docs/$slug" });
  return <DocsArticle key={slug} slug={slug} />;
}

export function DocsMissingArticle() {
  const en = useLocale();
  return <div className="p-8" id="docs-content" tabIndex={-1}><h1 className="text-2xl font-semibold">{uiText.text(en, "articleNotFound")}</h1><p className="mt-3 text-sm text-muted-foreground">{uiText.text(en, "useTheSidebarSearchOrReturnToThe")}</p><Link to="/docs" className="mt-6 inline-flex min-h-11 items-center text-sm underline">{uiText.text(en, "documentationOverview")}</Link></div>;
}

export function DocsArticle({ slug }: { slug: string }) {
  const locale = useLocale();
  const en = locale;
  const article = findDoc(slug)!;
  const group = DOC_GROUPS.find(item => item.id === article.group)!;
  const toc = useMemo(() => article.sections.map(section => ({ id: section.id, title: docText(section.title, locale) })), [article, locale]);
  const related = (article.related ?? []).flatMap(id => { const item = findDoc(id); return item ? [item] : []; });
  const index = DOC_ARTICLES.indexOf(article);
  const previous = DOC_ARTICLES[index - 1];
  const next = DOC_ARTICLES[index + 1];
  const knowledge = KNOWLEDGE_FAQS.find(item => item.id === article.knowledgeId);
  return <div className={styles.articleGrid} data-docs-article={slug}>
    <article className={styles.article} id="docs-content" tabIndex={-1}>
      <header className={styles.articleHeader}><p className={styles.eyebrow}>{docText(group.title, locale)}</p><h1>{docText(article.title, locale)}</h1><p>{docText(article.description, locale)}</p><CopyLink key={slug} /></header>
      {article.kind === "import" ? guidePages(locale).map((page, index) => <section className={styles.importSection} key={page.id} id={page.id} data-docs-import-step={index + 1}>
        <h2>{index + 1}. {page.title}</h2><p>{page.summary}</p>{page.content}
      </section>) : article.kind === "videos" ? <section id="videos" className={styles.videoContent}><Suspense fallback={<p role="status">{uiText.text(en, "loadingTutorials")}</p>}><VideoTutorials embedded /></Suspense></section>
        : article.kind === "faq" ? <section id="questions" className={styles.articleSection}><h2>{uiText.text(en, "findYourQuestion")}</h2><ArticleLinks articles={DOC_ARTICLES.filter(item => item !== article && (item.group === "faq" || item.knowledgeId))} /></section>
          : article.sections.map(section => <section className={styles.articleSection} id={section.id} key={section.id}>
            <h2>{docText(section.title, locale)}</h2>{section.paragraphs?.map((paragraph, i) => <p key={i}>{docText(paragraph, locale)}</p>)}{section.steps ? <ol>{section.steps.map((step, i) => <li key={i}>{docText(step, locale)}</li>)}</ol> : null}
          </section>)}
      {article.action ? <Link to={article.action.href} className={styles.actionLink}>{docText(article.action.label, locale)}<ArrowUpRight size={15} aria-hidden="true" /></Link> : null}
      {knowledge ? <div className={styles.attribution}><p>{helpKnowledgeText.text(en, "attribution")}</p><p><a href={knowledgeSourceUrl(knowledge.source)} target="_blank" rel="noreferrer">{uiText.text(en, "readTheSource")}</a> · <a href={KNOWLEDGE_REPOSITORY} target="_blank" rel="noreferrer">RIIC-knowledge</a></p></div> : null}
      {related.length ? <section className={styles.related}><h2>{uiText.text(en, "relatedArticles")}</h2><ArticleLinks articles={related} /></section> : null}
      <nav className={styles.pagination} aria-label={uiText.text(en, "previousAndNextArticles")}>
        {previous ? <Link to="/docs/$slug" params={{ slug: previous.slug }}><ArrowLeft size={16} aria-hidden="true" /><span><small>{uiText.text(en, "previous")}</small><strong>{docText(previous.title, locale)}</strong></span></Link> : <span />}
        {next ? <Link to="/docs/$slug" params={{ slug: next.slug }}><span><small>{uiText.text(en, "next")}</small><strong>{docText(next.title, locale)}</strong></span><ArrowRight size={16} aria-hidden="true" /></Link> : null}
      </nav>
      <DocsFooter />
    </article>
    <DocsTableOfContents key={slug} items={toc} />
  </div>;
}
