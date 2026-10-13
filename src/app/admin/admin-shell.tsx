"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, Command, LayoutDashboard, Search, ShieldCheck } from "lucide-react";
import { LanguageSwitch } from "@/i18n/client";
import { AppMotionProvider } from "@/components/MotionProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { adminNavigation, AdminNav } from "./admin-nav";

export function AdminShell({ children, isAdmin, name, basePath = "/admin" }: {
  children: ReactNode; isAdmin: boolean; name: string; basePath?: string;
}) {
  const t = useTranslations("AdminWorkspace");
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigation = useMemo(() => adminNavigation(isAdmin, basePath), [isAdmin, basePath]);
  const current = navigation.find(item => pathname === basePath + item.path) ?? navigation[0];
  const matches = navigation.filter(item => `${t(item.title)} ${t(item.description)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setSearchOpen(open => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return <AppMotionProvider><SidebarProvider cookieName="riic_admin_sidebar" style={{ "--sidebar-width": "15rem" } as CSSProperties} className="bg-background text-foreground">
    <a href="#admin-content" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground">{t("skip")}</a>
    <AdminNav isAdmin={isAdmin} name={name} basePath={basePath} />
    <div className="relative flex min-w-0 w-full flex-1 flex-col bg-background">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4 sm:px-6 lg:px-8">
        <SidebarTrigger aria-label={t("toggleSidebar")} className="size-9 shrink-0" />
        <span className="h-5 w-px bg-border" aria-hidden="true" />
        <nav aria-label={t("breadcrumb")} className="flex min-w-0 items-center gap-2 text-sm">
          <span className="hidden text-muted-foreground sm:inline">{t("workspace")}</span>
          <ChevronRight className="hidden size-3.5 text-muted-foreground sm:block" aria-hidden="true" />
          <span className="truncate font-medium" aria-current="page">{t(current.title)}</span>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button variant="outline" className="h-9 gap-2 text-muted-foreground" aria-label={t("searchPages")} onClick={() => { setQuery(""); setSearchOpen(true); }}>
            <Search aria-hidden="true" /><span className="hidden lg:inline">{t("searchPages")}</span>
            <kbd className="hidden rounded border px-1 py-0.5 font-mono text-[10px] lg:inline">Ctrl K</kbd>
          </Button>
          <LanguageSwitch />
          <span className="hidden size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold sm:flex" title={name}>{name.slice(0, 2).toUpperCase()}</span>
        </div>
      </header>
      {children}
      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:px-6 lg:px-8">
        <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5" aria-hidden="true" />RIIC · {t("workspace")}</span>
        <div className="flex gap-4"><Link className="hover:text-foreground focus-visible:underline" href="/privacy">{t("privacy")}</Link><Link className="hover:text-foreground focus-visible:underline" href="/terms">{t("terms")}</Link></div>
      </footer>
    </div>
    <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Command className="size-4" aria-hidden="true" />{t("searchPages")}</DialogTitle><DialogDescription>{t("searchDescription")}</DialogDescription></DialogHeader>
        <Input autoFocus aria-label={t("searchPages")} placeholder={t("searchPlaceholder")} value={query} onChange={event => setQuery(event.target.value)} />
        <nav aria-label={t("searchResults")} className="grid gap-1">
          {matches.map(item => <Link key={item.path} href={basePath + item.path} onClick={() => setSearchOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-3 outline-none hover:bg-muted focus-visible:bg-muted">
            <item.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0"><span className="block text-sm font-medium">{t(item.title)}</span><span className="block text-xs text-muted-foreground">{t(item.description)}</span></span><ChevronRight aria-hidden="true" className="ml-auto size-4 shrink-0 text-muted-foreground" />
          </Link>)}
          {!matches.length && <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><LayoutDashboard className="size-4" aria-hidden="true" />{t("noPages")}</p>}
        </nav>
      </DialogContent>
    </Dialog>
  </SidebarProvider></AppMotionProvider>;
}
