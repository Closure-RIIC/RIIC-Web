import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Menu } from "@base-ui/react/menu";
import { Calculator, SquarePen, Search, Settings, CircleHelp, UserRound, ChevronDown, SunMoon, LogOut, LoaderCircle, Cloud } from "lucide-react";
import { Sidebar, SidebarProvider, SidebarInset, SidebarHeader, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarFooter, SidebarTrigger, useSidebar } from "@riic/ui-primitives/sidebar";
import { TooltipProvider } from "@riic/ui-primitives/tooltip";
import { PageScrollbar } from "@riic/ui-primitives/page-scrollbar";
import { FluidOrb } from "@riic/ui-primitives/fluid-orb";
import { GameSwitcher } from "@riic/shell/GameSwitcher";
import { gameHref } from "@riic/shell/games";
import nav from "@riic/shell/AppSidebar.module.css";
import account from "@riic/shell/SidebarAccountMenu.module.css";
import { useWorkspace } from "../state";
import { useAccount } from "../account";
import { accountOrbColor } from "@riic/shell/account-orb";
import { SiteFooter } from "./SiteFooter";
import { RosterDialogProvider } from "./RosterDialog";
import { SolverLiveActivity } from "./SolverLiveActivity";

function AccountMenu() {
  const { locale, setLocale, t, colorMode, setColorMode } = useWorkspace();
  const { session, pending, failed, busy, run } = useAccount();
  const user = session?.user;
  const signingOut = busy === "sign-out";
  const { state, isMobile, setOpenMobile } = useSidebar();
  const [origin, setOrigin] = useState<string>();
  const [open, setOpen] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  useEffect(() => setOrigin(location.origin), []);
  async function signOut() {
    setSignOutError(false);
    try {
      await run("sign-out");
      setOpen(false);
      setOpenMobile(false);
    } catch {
      setSignOutError(true);
    }
  }
  const main = gameHref("arknights", origin, import.meta.env.VITE_ARKNIGHTS_ORIGIN);
  const compact = state === "collapsed" && !isMobile;
  const name = pending ? t("正在读取账号", "Loading account") : user?.name || t("登录 RIIC 账号", "Sign in to RIIC");
  return <div className={account.footer} data-sidebar-account-footer data-compact={compact || undefined}>
    <Menu.Root open={open} onOpenChange={value => { setOpen(value); if (value) setSignOutError(false); }}><Menu.Trigger className={account.card} aria-label={name} data-sidebar-account-trigger aria-busy={pending || signingOut || undefined}>
      {user ? <FluidOrb size={24} color={accountOrbColor(user.id)} animation="hover" data-sidebar-account-avatar data-account-orb-color={accountOrbColor(user.id)} /> : <span className={account.avatar}><UserRound size={15} /></span>}
      <span className={account.name} data-sidebar-account-name>{name}</span><ChevronDown className={account.chevron} />
    </Menu.Trigger><Menu.Portal><Menu.Positioner side={compact ? "right" : "top"} sideOffset={8} collisionPadding={12} className={account.positioner}>
      <Menu.Popup className={account.popup}>
        <div className="ef-language" aria-label={t("语言", "Language")}>{(["zh", "en"] as const).map(l => <button key={l} type="button" aria-pressed={locale === l} onClick={() => setLocale(l)}>{l === "zh" ? "中文" : "EN"}</button>)}</div>
        <Menu.Separator className={account.separator} />
        {!user && !pending ? <Menu.LinkItem className={`${account.item} ef-account-item`} render={<a href={`${main}account`} />}><UserRound />{t("登录 RIIC 账号", "Sign in to RIIC")}</Menu.LinkItem> : null}
        <Menu.Item className={`${account.item} ef-account-item`} onClick={() => setColorMode(colorMode === "dark" ? "light" : "dark")}><SunMoon />{t("切换明暗主题", "Toggle theme")}</Menu.Item>
        {user ? <Menu.Item className={`${account.item} ${account.destructiveItem} ef-account-item`} closeOnClick={false} disabled={busy !== null || pending} onClick={() => void signOut()}>
          {signingOut ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <LogOut />}
          {signingOut ? t("正在退出", "Signing out") : t("退出登录", "Sign out")}
        </Menu.Item> : null}
        {signOutError ? <p role="alert" className={account.error}>{t("退出登录失败，请重试。", "Unable to sign out. Please try again.")}</p> : null}
        {failed ? <p className={account.error}>{t("账号服务暂不可用，本地排班仍可使用。", "Account service unavailable. Local scheduling still works.")}</p> : null}
      </Menu.Popup>
    </Menu.Positioner></Menu.Portal></Menu.Root>
    <div className={account.actions}>
      <Link to="/docs" aria-label="Docs" className={account.iconButton}><CircleHelp /></Link>
      <Link to="/settings" preload={false} aria-label={t("设置", "Settings")} className={account.iconButton} data-sidebar-settings-trigger onClick={() => { setOpen(false); setOpenMobile(false); }}><Settings /></Link>
    </div>
  </div>;
}
function Navigation() {
  const { locale, t } = useWorkspace();
  const path = useRouterState({ select: s => s.location.pathname });
  const { setOpenMobile } = useSidebar();
  const links = [
    { to: "/" as const, label: t("自动排班", "Auto schedule"), icon: Calculator },
    { to: "/manual" as const, label: t("手动排班", "Manual schedule"), icon: SquarePen },
    { to: "/skills" as const, label: t("技能查询", "Ship skills"), icon: Search },
    { to: "/skland" as const, label: t("森空岛同步", "Skland sync"), icon: Cloud },
  ];
  return <Sidebar collapsible="icon" mobileWidth="min(17rem, calc(100vw - 3rem))"><div className={nav.sidebar}>
    <SidebarHeader className={nav.header}><GameSwitcher game="endfield" locale={locale} targetOrigin={import.meta.env.VITE_ARKNIGHTS_ORIGIN} /><SidebarTrigger className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground" /></SidebarHeader>
    <SidebarContent><SidebarGroup><SidebarGroupLabel>{t("帝江号", "Dijiang")}</SidebarGroupLabel><SidebarMenu>
      {links.map(({ to, label, icon: Icon }) => <SidebarMenuItem key={to}><SidebarMenuButton
        render={<Link to={to} preload={false} aria-current={path === to ? "page" : undefined} onClick={() => setOpenMobile(false)} />}
        isActive={path === to} tooltip={label} className="ef-nav-link"><Icon /><span className={nav.copy}>{label}</span></SidebarMenuButton></SidebarMenuItem>)}
    </SidebarMenu></SidebarGroup></SidebarContent>
    <SidebarFooter className={nav.footer}><AccountMenu /></SidebarFooter>
  </div></Sidebar>;
}
export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useWorkspace();
  return <TooltipProvider><SidebarProvider data-workbench-shell defaultOpen defaultOpenBreakpoint={1280} style={{ "--sidebar-width": "14rem", "--sidebar-width-icon": "3.25rem" } as CSSProperties}>
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
    <SolverLiveActivity />
    </RosterDialogProvider>
  </SidebarProvider></TooltipProvider>;
}
