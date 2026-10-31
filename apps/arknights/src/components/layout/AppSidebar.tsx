"use client";

import { lazyWithMessages } from "@/i18n/features-client";
import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../messages/zh-CN/AK_components_layout_AppSidebar.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_components_layout_AppSidebar");

import { messageRecord } from "@/i18n/translate";

import {
  Calculator,
  BookOpen,
  ClipboardCheck,
  Cloud,
  GraduationCap,
  History,
  LoaderCircle,
  ListChecks,
  Search,
  SquarePen,
  Bot,
  UserRoundPlus,
  type LucideIcon,
} from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { createContext, Suspense, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { useRouter } from "@/navigation";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import styles from "@riic/shell/AppSidebar.module.css";
import { GameSwitcher } from "@riic/shell/GameSwitcher";
import { SidebarAccountMenu } from "./SidebarAccountMenu";
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
import { useLocale, useTranslations } from "use-intl";

const CLIENT_SKLAND_ENABLED = process.env.APP_CLIENT_SKLAND_ENABLED === "1";
const AgentHistoryNavigation = lazyWithMessages(() => import("@/components/agent/AgentHistoryNavigation").then((module) => ({ default: module.AgentHistoryNavigation })), "apps/arknights/src/components/agent/AgentHistoryNavigation.tsx");
const SidebarHighlight = createContext<{ target: string; setHovered: (target: string | null) => void }>({ target: "", setHovered: () => undefined });

interface AppSidebarProps {
  onboarding?: { completed: number; total: number; onOpen: () => void };
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
  const pending = useRouterState({ select: state => state.status === "pending" && state.location.pathname === href });
  const highlight = useContext(SidebarHighlight);
  const reducedMotion = useReducedMotion();
  const router = useRouter();
  useEffect(() => () => router.cancelPrefetch(href), [router, href]);

  return (
    <SidebarMenuItem onPointerEnter={() => highlight.setHovered(target)} onFocus={() => highlight.setHovered(target)}>
      {highlight.target === target ? <motion.span aria-hidden="true" className={styles.highlight} layoutId="sidebar-highlight" initial={false} transition={{ duration: reducedMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }} /> : null}
      <SidebarMenuButton
        render={(
          <Link
            to={href}
            preload={false}
            role="button"
            aria-label={label}
            aria-current={page === target ? "page" : undefined}
            aria-busy={pending || undefined}
            data-primary-navigation-page={target}
            onPointerEnter={(event) => { if (event.pointerType === "mouse" && page !== target) router.prefetch(href); }}
            onPointerLeave={() => router.cancelPrefetch(href)}
            onFocus={(event) => { if (event.currentTarget.matches(":focus-visible") && page !== target) router.prefetch(href); }}
            onBlur={() => router.cancelPrefetch(href)}
            onClick={(event) => {
              router.cancelPrefetch(href);
              if (!onPageChange(target, event.currentTarget)) event.preventDefault();
              if (isMobile) setOpenMobile(false);
            }}
          />
        )}
        isActive={page === target}
        tooltip={label}
      >
        {pending ? <LoaderCircle aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" /> : <Icon className="size-5" />}
        <span className={styles.copy}>{label}</span>
      </SidebarMenuButton>
      {children}
    </SidebarMenuItem>
  );
}

export function AppSidebar({ page, onPageChange, showMower = false, onSessionChanged, onboarding }: AppSidebarProps & {
  onSessionChanged: (authenticated: boolean) => Promise<void>;
}) {
  const locale = useLocale();
  const onboardingText = useTranslations("Onboarding");
  const { isMobile, setOpenMobile } = useSidebar();
  const { data: websiteSession } = useWebsiteSession();
  const features = useFeatureAccess();
  const labels = messageRecord(locale, "components_layout_AppSidebar_labels");
  const [hovered, setHovered] = useState<string | null>(null);
  const highlightId = useId();
  return (
    <Sidebar collapsible="icon" mobileWidth="min(17rem, calc(100vw - 3rem))" data-primary-navigation-prefetch="intent-code">
      <div className={styles.sidebar} data-beautiful-sidebar onPointerLeave={() => setHovered(null)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setHovered(null); }}>
      <SidebarHeader className={styles.header}>
        <GameSwitcher game="arknights" locale={locale} targetOrigin={import.meta.env.VITE_ENDFIELD_ORIGIN} />
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
            {showMower ? <AppNavigationItem page={page} target="mower" label={uiText.text(locale, "mowerSchedule")} icon={Bot} onPageChange={onPageChange} /> : null}
            <AppNavigationItem page={page} target="training" label={labels.training} icon={GraduationCap} onPageChange={onPageChange} />
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>{labels.progressionGroup}</SidebarGroupLabel>
          <SidebarMenu>
            <AppNavigationItem page={page} target="account-health" label={uiText.text(locale, "accountHealth")} icon={ClipboardCheck} onPageChange={onPageChange} />
            <AppNavigationItem page={page} target="training-planner" label={labels.trainingPlanner} icon={Calculator} onPageChange={onPageChange} />
            <AppNavigationItem page={page} target="mastery" label={labels.mastery} icon={BookOpen} onPageChange={onPageChange} />
            <AppNavigationItem page={page} target="recruitment" label={labels.recruitment} icon={UserRoundPlus} onPageChange={onPageChange} />
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>{labels.skillsGroup}</SidebarGroupLabel>
          <SidebarMenu>
            <AppNavigationItem page={page} target="skill-query" label={labels.skills} icon={Search} onPageChange={onPageChange} />
          </SidebarMenu>
        </SidebarGroup>
        {features.agent ? <SidebarGroup>
          <SidebarGroupLabel>{uiText.text(locale, "aiAssistant")}</SidebarGroupLabel>
          <SidebarMenu>
            <AppNavigationItem page={page} target="agent" label={uiText.text(locale, "closureAssistant")} icon={Bot} onPageChange={onPageChange}>
              {websiteSession ? <Suspense fallback={null}><AgentHistoryNavigation active={page === "agent"} /></Suspense> : null}
            </AppNavigationItem>
          </SidebarMenu>
        </SidebarGroup> : null}
        {CLIENT_SKLAND_ENABLED ? <SidebarGroup>
          <SidebarGroupLabel>{labels.personalGroup}</SidebarGroupLabel>
          <SidebarMenu>
            <AppNavigationItem page={page} target="skland" label={labels.skland} icon={Cloud} onPageChange={onPageChange} />
            <AppNavigationItem page={page} target="gacha" label={labels.gacha} icon={History} onPageChange={onPageChange} />
          </SidebarMenu>
        </SidebarGroup> : null}
      </SidebarContent>
      </LayoutGroup>
      </SidebarHighlight.Provider>
      <SidebarFooter className={styles.footer}>
        {onboarding ? <SidebarMenu><SidebarMenuItem><SidebarMenuButton tooltip={onboardingText("title")} data-onboarding-trigger onClick={() => { if (isMobile) setOpenMobile(false); onboarding.onOpen(); }}>
          <ListChecks className="size-5" aria-hidden="true" />
          <span className={styles.copy}>{onboardingText("title")}</span>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground group-data-[collapsible=icon]:hidden" aria-hidden="true">{onboarding.completed}/{onboarding.total}</span>
        </SidebarMenuButton></SidebarMenuItem></SidebarMenu> : null}
        <SidebarAccountMenu page={page} onPageChange={onPageChange} onSessionChanged={onSessionChanged} />
      </SidebarFooter>
      </div>
    </Sidebar>
  );
}
