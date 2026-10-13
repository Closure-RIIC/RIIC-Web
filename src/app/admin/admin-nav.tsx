"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowUpRight, BookOpen, Bug, FlaskConical, Gauge, Gift, MessageSquareText, ShieldCheck, UsersRound } from "lucide-react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";

export const ADMIN_NAVIGATION = [
  { path: "", title: "overview", description: "overviewHint", icon: Gauge, adminOnly: false, group: "operations" },
  { path: "/issues", title: "issues", description: "issuesHint", icon: Bug, adminOnly: false, group: "operations" },
  { path: "/quality", title: "quality", description: "qualityHint", icon: FlaskConical, adminOnly: false, group: "operations" },
  { path: "/skills", title: "skills", description: "skillsHint", icon: MessageSquareText, adminOnly: true, group: "management" },
  { path: "/changelog", title: "changelog", description: "changelogHint", icon: BookOpen, adminOnly: true, group: "management" },
  { path: "/users", title: "users", description: "usersHint", icon: UsersRound, adminOnly: true, group: "management" },
  { path: "/billing", title: "billing", description: "billingHint", icon: Gift, adminOnly: true, group: "management" },
  { path: "/agent", title: "agent", description: "agentHint", icon: ShieldCheck, adminOnly: true, group: "management" },
] as const;

export function adminNavigation(isAdmin: boolean, basePath: string) {
  return ADMIN_NAVIGATION.filter(item => (isAdmin || !item.adminOnly) && (basePath === "/admin" || !["/billing", "/agent"].includes(item.path)));
}

export function AdminNav({ isAdmin, name, basePath = "/admin" }: { isAdmin: boolean; name: string; basePath?: string }) {
  const t = useTranslations("AdminWorkspace");
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const items = adminNavigation(isAdmin, basePath);
  return <Sidebar collapsible="icon" mobileWidth="18rem" className="border-r-0">
    <SidebarHeader className="h-16 justify-center px-3">
      <Link href={basePath} onClick={() => setOpenMobile(false)} className="flex items-center gap-2.5 rounded-lg p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("workspace")}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><ShieldCheck className="size-5" aria-hidden="true" /></span>
        <span className="grid min-w-0 group-data-[collapsible=icon]:hidden"><span className="text-sm font-semibold tracking-tight">RIIC Admin</span><span className="text-[11px] text-muted-foreground">{t("workspace")}</span></span>
      </Link>
    </SidebarHeader>
    <SidebarContent>
      <nav aria-label={t("navigation")}>
        {(["operations", "management"] as const).map(group => {
          const visible = items.filter(item => item.group === group);
          return visible.length ? <SidebarGroup key={group} className="px-3">
            <SidebarGroupLabel className="px-2 text-[11px]">{t(group)}</SidebarGroupLabel>
            <SidebarMenu className="gap-1">
              {visible.map(item => {
                const href = basePath + item.path;
                const active = item.path ? pathname === href || pathname.startsWith(href + "/") : pathname === href;
                return <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton isActive={active} tooltip={t(item.title)} className="h-10 gap-3 rounded-lg data-[active=true]:bg-primary/8 data-[active=true]:font-semibold motion-safe:active:scale-[0.98]"
                    render={<Link href={href} aria-current={active ? "page" : undefined} onClick={() => setOpenMobile(false)} />}>
                    <item.icon aria-hidden="true" className="size-4" /><span>{t(item.title)}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>;
              })}
            </SidebarMenu>
          </SidebarGroup> : null;
        })}
      </nav>
    </SidebarContent>
    <SidebarFooter className="gap-3 px-3 pb-4">
      <SidebarMenu><SidebarMenuItem><SidebarMenuButton tooltip={t("backToSite")} className="h-10" render={<Link href="/" />}><ArrowUpRight className="size-4" aria-hidden="true" /><span>{t("backToSite")}</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu>
      <div className="flex items-center gap-2.5 border-t pt-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold" aria-hidden="true">{name.slice(0, 2).toUpperCase()}</span>
        <div className="grid min-w-0 group-data-[collapsible=icon]:hidden"><span className="truncate text-xs font-medium">{name}</span><span className="mt-0.5 text-[11px] text-muted-foreground">{t(isAdmin ? "administrator" : "reviewer")}</span></div>
      </div>
    </SidebarFooter>
  </Sidebar>;
}
