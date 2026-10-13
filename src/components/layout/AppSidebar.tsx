"use client";
import { messageRecord } from "@/i18n/translate";

import {
  Calculator,
  BookOpen,
  CircleHelp,
  ClipboardCheck,
  Cloud,
  CreditCard,
  GraduationCap,
  History,
  Search,
  Settings2,
  SquarePen,
  Bot,
  UserRound,
  UserRoundPlus,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { createContext, lazy, Suspense, useContext, useId, useState, type ReactNode } from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import styles from "./AppSidebar.module.css";
import { useWebsiteSession } from "@/website-session";
import { useFeatureAccess } from "@/components/workbench/FeatureAccessProvider";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { workbenchHref, type AppPage } from "@/workbench-routes";
import { useLocale } from "next-intl";

const CLIENT_SKLAND_ENABLED = process.env.APP_CLIENT_SKLAND_ENABLED === "1";
const AgentHistoryNavigation = lazy(() => import("@/components/agent/AgentHistoryNavigation").then((module) => ({ default: module.AgentHistoryNavigation })));
const SidebarHighlight = createContext<{ target: string; setHovered: (target: string | null) => void }>({ target: "", setHovered: () => undefined });

interface AppSidebarProps {
  showMower?: boolean;
  page: AppPage;
  onPageChange: (page: AppPage, trigger?: HTMLElement) => boolean;
}

interface AppNavigationItemProps extends AppSidebarProps {
  target: AppPage;
  label: string;
  icon: LucideIcon;
  children?: ReactNode;
}

function AppNavigationItem({
  page,
  target,
  label,
  icon: Icon,
  onPageChange,
  children,
}: AppNavigationItemProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  const href = workbenchHref(target);
  const highlight = useContext(SidebarHighlight);
  const reducedMotion = useReducedMotion();

  return (
    <SidebarMenuItem onPointerEnter={() => highlight.setHovered(target)} onFocus={() => highlight.setHovered(target)}>
      {highlight.target === target ? <motion.span aria-hidden="true" className={styles.highlight} layoutId="sidebar-highlight" initial={false} transition={{ duration: reducedMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }} /> : null}
      <SidebarMenuButton
        render={(
          <Link
            href={href}
            role="button"
            aria-label={label}
            aria-current={page === target ? "page" : undefined}
            data-primary-navigation-page={target}
            onClick={(event) => {
              if (!onPageChange(target, event.currentTarget)) event.preventDefault();
              if (isMobile) setOpenMobile(false);
            }}
          />
        )}
        isActive={page === target}
        tooltip={label}
      >
        <Icon className="size-5" />
        <span className={styles.copy}>{label}</span>
      </SidebarMenuButton>
      {children}
    </SidebarMenuItem>
  );
}

export function AppSidebar({ page, onPageChange, showMower = false }: AppSidebarProps) {
  const locale = useLocale();
  const { data: websiteSession } = useWebsiteSession();
  const features = useFeatureAccess();
  const labels = messageRecord(locale, "components_layout_AppSidebar_labels");
  const billingLabel = locale === "en" ? "Payment plans" : "付费计划";
  const [hovered, setHovered] = useState<string | null>(null);
  const highlightId = useId();
  return (
    <Sidebar collapsible="icon" mobileWidth="min(17rem, calc(100vw - 3rem))" data-primary-navigation-prefetch="eager">
      <div className={styles.sidebar} data-beautiful-sidebar onPointerLeave={() => setHovered(null)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setHovered(null); }}>
      <SidebarHeader className={styles.header}>
        <SidebarTrigger className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground" />
      </SidebarHeader>
      <SidebarHighlight.Provider value={{ target: hovered ?? "", setHovered }}>
      <LayoutGroup id={highlightId}>
      <SidebarContent data-yeye-scroll={undefined}>
        <SidebarGroup>
          <SidebarGroupLabel>{labels.schedulingGroup}</SidebarGroupLabel>
          <SidebarMenu>
            <AppNavigationItem page={page} target="calculator" label={labels.calculator} icon={Calculator} onPageChange={onPageChange} />
            <AppNavigationItem page={page} target="manual" label={labels.manual} icon={SquarePen} onPageChange={onPageChange} />
            {showMower ? <AppNavigationItem page={page} target="mower" label={locale === "en" ? "Mower Schedule" : "排班表（Mower）"} icon={Bot} onPageChange={onPageChange} /> : null}
            <AppNavigationItem page={page} target="training" label={labels.training} icon={GraduationCap} onPageChange={onPageChange} />
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>{labels.progressionGroup}</SidebarGroupLabel>
          <SidebarMenu>
            <AppNavigationItem page={page} target="account-health" label={locale === "en" ? "Account Health" : "账号体检"} icon={ClipboardCheck} onPageChange={onPageChange} />
            <AppNavigationItem page={page} target="mastery" label={labels.mastery} icon={BookOpen} onPageChange={onPageChange} />
            <AppNavigationItem page={page} target="recruitment" label={labels.recruitment} icon={UserRoundPlus} onPageChange={onPageChange} />
            {CLIENT_SKLAND_ENABLED ? <AppNavigationItem page={page} target="gacha" label={locale === "en" ? "Headhunting history" : "寻访记录"} icon={History} onPageChange={onPageChange} /> : null}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>{labels.skillsGroup}</SidebarGroupLabel>
          <SidebarMenu>
            <AppNavigationItem page={page} target="skill-query" label={labels.skills} icon={Search} onPageChange={onPageChange} />
          </SidebarMenu>
        </SidebarGroup>
        {features.agent ? <SidebarGroup>
          <SidebarGroupLabel>{locale === "en" ? "AI Assistant" : "智能助理"}</SidebarGroupLabel>
          <SidebarMenu>
            <AppNavigationItem page={page} target="agent" label={locale === "en" ? "Closure Assistant" : "可露希尔助理"} icon={Bot} onPageChange={onPageChange}>
              {websiteSession ? <Suspense fallback={null}><AgentHistoryNavigation active={page === "agent"} /></Suspense> : null}
            </AppNavigationItem>
          </SidebarMenu>
        </SidebarGroup> : null}
        <SidebarGroup>
          <SidebarGroupLabel>{labels.personalGroup}</SidebarGroupLabel>
          <SidebarMenu>
            {CLIENT_SKLAND_ENABLED ? (
              <AppNavigationItem page={page} target="skland" label={labels.skland} icon={Cloud} onPageChange={onPageChange} />
            ) : null}
            <AppNavigationItem page={page} target="account" label={labels.account} icon={UserRound} onPageChange={onPageChange} />
            {features.billing ? <AppNavigationItem page={page} target="billing" label={billingLabel} icon={CreditCard} onPageChange={onPageChange} /> : null}
            <AppNavigationItem page={page} target="settings" label={labels.settings} icon={Settings2} onPageChange={onPageChange} />
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      </LayoutGroup>
      </SidebarHighlight.Provider>
      <SidebarFooter className={styles.footer}>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href="/changelog" aria-label={locale === "en" ? "Changelog" : "更新日志"} data-changelog-link />}
              tooltip={locale === "en" ? "Changelog" : "更新日志"}
            >
              <BookOpen className="size-5" />
              <span className={styles.copy}>{locale === "en" ? "Changelog" : "更新日志"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href="/help" aria-label={labels.help} data-help-link />}
              tooltip={labels.help}
            >
              <CircleHelp className="size-5" />
              <span className={styles.copy}>{labels.help}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      </div>
    </Sidebar>
  );
}
