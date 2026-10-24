"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { useLocale } from "use-intl";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageSwitch } from "@/i18n/client";
import { DOC_ARTICLES, DOC_GROUPS, docText, findDoc, searchDocs } from "@/docs/content";
import sidebarStyles from "@riic/shell/AppSidebar.module.css";
import styles from "./DocsLayout.module.css";

function DocsNavigation({ slug, onSearch }: { slug: string; onSearch: () => void }) {
  const locale = useLocale();
  const en = locale === "en";
  const { setOpenMobile, isMobile } = useSidebar();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const activeGroup = findDoc(slug)?.group;
  const closeMobile = () => setOpenMobile(false);
  return <Sidebar collapsible="offcanvas" mobileWidth="min(18rem, calc(100vw - 3rem))">
    <div className={`${sidebarStyles.sidebar} ${styles.sidebar}`} data-docs-sidebar>
      <SidebarHeader className={styles.sidebarHeader}>
        <div className={styles.brandRow}>
          <Link to="/docs" onClick={closeMobile} className={styles.brand}><img src="/icon.png" width="22" height="22" alt="" /><span>{en ? "RIIC Docs" : "使用文档"}</span></Link>
          {isMobile ? <button type="button" onClick={closeMobile} className={styles.iconButton} aria-label={en ? "Close navigation" : "关闭目录"}><X size={17} /></button> : null}
        </div>
        <Link to="/" className={styles.backLink}><ArrowLeft size={14} aria-hidden="true" />{en ? "Back to workbench" : "返回基建"}</Link>
        <button type="button" onClick={() => { closeMobile(); onSearch(); }} className={styles.searchTrigger}><Search size={15} aria-hidden="true" /><span>{en ? "Search docs" : "搜索文档"}</span><kbd>Ctrl K</kbd></button>
      </SidebarHeader>
      <SidebarContent data-yeye-scroll="y" className={styles.navigationScroll}>
        <nav aria-label={en ? "Documentation" : "文档目录"}>
          <SidebarMenu className={styles.overviewLink}><SidebarMenuItem><SidebarMenuButton isActive={!slug} render={<Link to="/docs" onClick={closeMobile} aria-current={!slug ? "page" : undefined} />}><span>{en ? "Overview" : "文档首页"}</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu>
          {DOC_GROUPS.map(group => {
            const open = expanded[group.id] ?? (group.id === "start" || group.id === activeGroup);
            return <section key={group.id} className={styles.navGroup}>
              <button type="button" className={styles.groupToggle} aria-expanded={open} aria-controls={`docs-group-${group.id}`} onClick={() => setExpanded(current => ({ ...current, [group.id]: !open }))}>
                <span>{docText(group.title, locale)}</span><ChevronRight size={13} aria-hidden="true" className={open ? styles.expanded : undefined} />
              </button>
              <SidebarMenu id={`docs-group-${group.id}`} hidden={!open}>
                {DOC_ARTICLES.filter(article => article.group === group.id).map(article => <SidebarMenuItem key={article.slug}>
                  <SidebarMenuButton isActive={article.slug === slug} render={<Link to="/docs/$slug" params={{ slug: article.slug }} onClick={closeMobile} aria-current={article.slug === slug ? "page" : undefined} title={docText(article.title, locale)} />}>
                    <span className={sidebarStyles.copy}>{docText(article.title, locale)}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>)}
              </SidebarMenu>
            </section>;
          })}
        </nav>
      </SidebarContent>
      <SidebarFooter className={styles.sidebarFooter}>
        <LanguageSwitch />
        <a href="https://github.com/Closure-RIIC/RIIC-Web/issues" target="_blank" rel="noreferrer" className={styles.supportLink}>{en ? "Feedback" : "反馈问题"}<ArrowUpRight size={13} aria-hidden="true" /></a>
      </SidebarFooter>
    </div>
  </Sidebar>;
}

function DocsSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const locale = useLocale();
  const en = locale === "en";
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const results = searchDocs(query, locale);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent initialFocus={input} className={styles.searchDialog}>
      <DialogTitle className="sr-only">{en ? "Search documentation" : "搜索文档"}</DialogTitle>
      <DialogDescription className="sr-only">{en ? "Search titles and content. Use arrow keys to browse results, Enter to open, and Escape to close." : "搜索标题与正文。方向键选择结果，回车打开，Esc 关闭。"}</DialogDescription>
      <div className={styles.searchInputRow}><Search size={19} aria-hidden="true" /><input ref={input} value={query} onChange={event => setQuery(event.target.value)} placeholder={en ? "What would you like to know?" : "你想了解什么？"} aria-label={en ? "Search documentation" : "搜索文档"} onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); resultsRef.current?.querySelector<HTMLAnchorElement>("a")?.focus(); } }} /></div>
      <div className={styles.searchResults} ref={resultsRef} data-yeye-scroll="y" onKeyDown={event => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>("a"));
        const index = links.indexOf(document.activeElement as HTMLAnchorElement);
        if (index < 0) return;
        event.preventDefault();
        if (event.key === "ArrowUp" && index === 0) { input.current?.focus(); return; }
        links[event.key === "Home" ? 0 : event.key === "End" ? links.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + links.length) % links.length]?.focus();
      }}>
        <p className={styles.searchLabel} role="status">{query.trim() ? (en ? `${results.length} results` : `${results.length} 篇相关文档`) : (en ? "Start here" : "从这里开始")}</p>
        {results.map(article => <Link key={article.slug} to="/docs/$slug" params={{ slug: article.slug }} onClick={() => onOpenChange(false)} className={styles.searchResult}>
          <span><small>{docText(DOC_GROUPS.find(group => group.id === article.group)!.title, locale)}</small><strong>{docText(article.title, locale)}</strong><span>{docText(article.description, locale)}</span></span><ChevronRight size={16} aria-hidden="true" />
        </Link>)}
        {!results.length ? <p className={styles.emptySearch}>{en ? "No matching articles. Try “import”, “MAA”, or “sync”." : "没有找到相关文档，试试「导入」「MAA」或「同步」。"}</p> : null}
      </div>
    </DialogContent>
  </Dialog>;
}

export function DocsLayout({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const en = locale === "en";
  const pathname = useLocation({ select: location => location.pathname });
  const slug = pathname.split("/")[2] ?? "";
  const article = findDoc(slug);
  const group = DOC_GROUPS.find(item => item.id === article?.group);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen(open => !open); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return <TooltipProvider><SidebarProvider cookieName="docs_sidebar_state" data-workbench-shell data-docs-shell style={{ "--sidebar-width": "14rem" } as CSSProperties}>
    <a href="#docs-content" className={styles.skipLink}>{en ? "Skip to content" : "跳转到正文"}</a>
    <DocsNavigation key={article?.group ?? "home"} slug={slug} onSearch={() => setSearchOpen(true)} />
    <SidebarInset>
      <header className={styles.topbar} data-docs-topbar>
        <SidebarTrigger aria-label={en ? "Toggle navigation" : "展开或收起目录"} />
        <nav aria-label={en ? "Breadcrumb" : "当前位置"} className={styles.breadcrumb}>
          <Link to="/docs">{en ? "Docs" : "使用文档"}</Link>
          {group ? <><ChevronRight size={12} aria-hidden="true" /><span>{docText(group.title, locale)}</span></> : null}
          {article ? <><ChevronRight size={12} aria-hidden="true" /><span aria-current="page">{docText(article.title, locale)}</span></> : null}
        </nav>
        <button type="button" onClick={() => setSearchOpen(true)} className={styles.iconButton} aria-label={en ? "Search documentation" : "搜索文档"}><Search size={17} /></button>
      </header>
      <div data-app-scroll-area="docs" data-scroll-restoration-id="docs-page" data-yeye-scroll="y" data-yeye-scroll-slot="docs-page-scrollbar" className={styles.viewport}>
        {children}
      </div>
    </SidebarInset>
    <div id="docs-page-scrollbar" data-yeye-scroll-slot-host data-app-page-scrollbar aria-hidden="true" />
    <DocsSearch open={searchOpen} onOpenChange={setSearchOpen} />
  </SidebarProvider></TooltipProvider>;
}

export function DocsBackToTop({ className }: { className?: string }) {
  const en = useLocale() === "en";
  return <button type="button" className={className} data-docs-back-to-top onClick={() => {
    document.getElementById("docs-content")?.focus({ preventScroll: true });
    document.querySelector('[data-app-scroll-area="docs"]')?.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }}>{en ? "Back to top" : "回到顶部"}</button>;
}

export function DocsTableOfContents({ items }: { items: { id: string; title: string }[] }) {
  const en = useLocale() === "en";
  const [active, setActive] = useState(items[0]?.id);
  useEffect(() => {
    const root = document.querySelector('[data-app-scroll-area="docs"]');
    if (!root) return;
    const observer = new IntersectionObserver(entries => {
      const entry = entries.filter(item => item.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (entry) setActive(entry.target.id);
    }, { root, rootMargin: "-4% 0px -65% 0px", threshold: 0 });
    items.forEach(item => { const element = document.getElementById(item.id); if (element) observer.observe(element); });
    return () => observer.disconnect();
  }, [items]);
  const links = <nav aria-label={en ? "On this page" : "本页目录"}>{items.map(item => <a key={item.id} href={`#${item.id}`} aria-current={active === item.id ? "location" : undefined} onClick={() => setActive(item.id)}>{item.title}</a>)}</nav>;
  return <>
    <details className={styles.mobileToc}><summary>{en ? "On this page" : "本页目录"}<ChevronDown size={14} /></summary>{links}</details>
    <aside className={styles.toc}><p>{en ? "On this page" : "本页目录"}</p>{links}<DocsBackToTop className={styles.backToTop} /></aside>
  </>;
}
