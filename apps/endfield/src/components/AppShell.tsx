import { type CSSProperties, type ReactNode } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { Calculator, SquarePen, Timer, Search, Cloud } from "lucide-react";
import { Sidebar, SidebarProvider, SidebarInset, SidebarHeader, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarFooter, SidebarTrigger, useSidebar } from "@riic/ui-primitives/sidebar";
import { TooltipProvider } from "@riic/ui-primitives/tooltip";
import { PageScrollbar } from "@riic/ui-primitives/page-scrollbar";
import { GameSwitcher } from "@riic/shell/GameSwitcher";
import nav from "@riic/shell/AppSidebar.module.css";
import { useWorkspace } from "../state";
import { pageLabels } from "../page-labels";
import { useAccount } from "../account";
import { SidebarAccountMenu as SharedAccountMenu } from "@riic/shell/SidebarAccountMenu";
import { requestAccountSignIn } from "@riic/shell/account-sign-in";
import { AccountDialogHost } from "./AccountDialogHost";
import { SiteFooter } from "./SiteFooter";
import { RosterDialogProvider } from "./RosterDialog";
import { WorkspaceLiveActivity } from "./WorkspaceLiveActivity";

function AccountMenu() {
  const router = useRouter();
  const { locale, setLocale } = useWorkspace();
  const { session, pending, failed, busy, run } = useAccount();
  const path = useRouterState({ select: state => state.location.pathname });
  return <SharedAccountMenu user={session?.user} pending={pending} busy={busy !== null} unavailable={failed}
    language={{ locale, setLocale }} currentPage={path === "/settings" ? "settings" : undefined}
    links={{ changelog: <Link to="/changelog" preload={false} />,
      docs: <Link to="/docs" data-docs-link />, settings: <Link to="/settings" preload={false} /> }}
    onSignIn={requestAccountSignIn} onSignOut={async () => { await run("sign-out"); await router.navigate({ to: "/" }); }} />;
}
function Navigation() {
  const { locale, t } = useWorkspace();
  const path = useRouterState({ select: s => s.location.pathname });
  const { setOpenMobile } = useSidebar();
  const links = [
    { to: "/" as const, label: t(...pageLabels["/"]), icon: Calculator },
    { to: "/manual" as const, label: t(...pageLabels["/manual"]), icon: SquarePen },
    { to: "/step" as const, label: t(...pageLabels["/step"]), icon: Timer },
    { to: "/skills" as const, label: t(...pageLabels["/skills"]), icon: Search },
    { to: "/skland" as const, label: t(...pageLabels["/skland"]), icon: Cloud },
  ];
  return <Sidebar collapsible="icon" mobileWidth="min(17rem, calc(100vw - 3rem))"><div className={nav.sidebar}>
    <SidebarHeader className={nav.header}><GameSwitcher game="endfield" locale={locale} targetOrigin={import.meta.env.VITE_ARKNIGHTS_ORIGIN} /><SidebarTrigger className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground" /></SidebarHeader>
    <SidebarContent><SidebarGroup><SidebarGroupLabel>{t("帝江号", "Dijiang")}</SidebarGroupLabel><SidebarMenu>
      {links.map(({ to, label, icon: Icon }) => <SidebarMenuItem key={to}><SidebarMenuButton
        render={<Link to={to} preload={false} aria-label={label} aria-current={path === to ? "page" : undefined} onClick={() => setOpenMobile(false)} />}
        isActive={path === to} tooltip={label} className="ef-nav-link"><Icon /><span className={nav.copy}>{label}</span></SidebarMenuButton></SidebarMenuItem>)}
    </SidebarMenu></SidebarGroup></SidebarContent>
    <SidebarFooter className={nav.footer}><AccountMenu /></SidebarFooter>
  </div></Sidebar>;
}
export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useWorkspace();
  const path = useRouterState({ select: state => state.location.pathname });
  const label = pageLabels[path.replace(/\/+$/, "") || "/"];
  const title = label ? `${t(...label)} · 帝江号基建终端` : "帝江号基建终端";
  return <TooltipProvider><SidebarProvider data-workbench-shell defaultOpen defaultOpenBreakpoint={1280} style={{ "--sidebar-width": "14rem", "--sidebar-width-icon": "3.25rem" } as CSSProperties}>
    <title>{title}</title>
    <RosterDialogProvider>
    <Navigation />
    <SidebarInset className="ef-theme isolate">
      <SidebarTrigger className="ef-mobile-navigation md:hidden" data-endfield-mobile-navigation aria-label={t("展开侧边栏", "Open sidebar")} />
      <div data-app-scroll-area="endfield" data-scroll-restoration-id="endfield-page" data-yeye-scroll="y" data-yeye-scroll-slot="endfield-scrollbar">
        <div className="ef-page-content" data-app-content>{children}</div>
        <SiteFooter />
      </div>
    </SidebarInset>
    <div id="endfield-scrollbar" data-app-page-scrollbar data-yeye-scroll-slot-host />
    <PageScrollbar />
    <WorkspaceLiveActivity />
    <AccountDialogHost />
    </RosterDialogProvider>
  </SidebarProvider></TooltipProvider>;
}
