"use client";

import { useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { Link } from "@tanstack/react-router";
import { BookOpen, ChevronDown, CircleHelp, CreditCard, LoaderCircle, LogOut, Settings, UserRound } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useLocale } from "use-intl";
import { accountOrbColor } from "@/account-orb";
import { FluidOrb } from "@/components/ui/fluid-orb";
import { Skeleton } from "@/components/ui/skeleton";
import { useSidebar } from "@/components/ui/sidebar";
import { useFeatureAccess } from "@/components/workbench/FeatureAccessProvider";
import { messageRecord } from "@/i18n/translate";
import { useLanguageSwitch } from "@/i18n/client";
import { authClient } from "@/lib/auth-client";
import { useWebsiteSession } from "@/website-session";
import { workbenchHref, type AppPage } from "@/workbench-routes";
import styles from "../../../../../packages/shell/SidebarAccountMenu.module.css";

export function SidebarAccountMenu({ page, onPageChange, onSessionChanged }: {
  page: AppPage;
  onPageChange: (page: AppPage, trigger?: HTMLElement) => boolean;
  onSessionChanged: (authenticated: boolean) => Promise<void>;
}) {
  const labels = messageRecord(useLocale(), "components_layout_AppSidebar_labels");
  const language = useLanguageSwitch();
  const { data: session, isPending } = useWebsiteSession();
  const features = useFeatureAccess();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const highlightId = useId();
  const reducedMotion = useReducedMotion();
  const navigating = useRef(false);
  const compact = state === "collapsed" && !isMobile;
  const loadingAccount = isPending && !session;
  const name = session?.user.name.trim() || labels.anonymousName;
  const orbColor = session ? accountOrbColor(session.user.id) : undefined;

  function renderItemContent(highlighted: boolean, children: ReactNode) {
    return <>
      {highlighted ? <motion.span
        aria-hidden="true"
        className={styles.highlight}
        data-account-menu-highlight
        layoutId={highlightId}
        initial={false}
        transition={{ duration: reducedMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
      /> : null}
      <span className={styles.itemContent}>{children}</span>
    </>;
  }

  function closeForNavigation() {
    navigating.current = true;
    setOpen(false);
    if (isMobile) setOpenMobile(false);
  }

  function navigate(event: MouseEvent<HTMLAnchorElement>, target: AppPage) {
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
      if (!onPageChange(target, triggerRef.current ?? event.currentTarget)) event.preventDefault();
    }
    closeForNavigation();
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setError(null);
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message);
      await onSessionChanged(false);
      closeForNavigation();
    } catch {
      setError(labels.signOutFailed);
    } finally {
      setSigningOut(false);
    }
  }

  return <div className={styles.footer} data-sidebar-account-footer data-compact={compact || undefined}>
    <Menu.Root open={open} onOpenChange={(nextOpen) => {
      if (nextOpen) { navigating.current = false; setError(null); }
      setOpen(nextOpen);
    }}>
      <Menu.Trigger
        ref={triggerRef}
        className={styles.card}
        data-sidebar-account-trigger
        aria-label={`${labels.accountMenu}: ${loadingAccount ? labels.loadingAccount : name}`}
        aria-busy={isPending || signingOut || undefined}
        title={loadingAccount ? labels.loadingAccount : name}
      >
        {loadingAccount ? <Skeleton className={styles.avatar} /> : session ? <FluidOrb
          size={24}
          color={orbColor}
          animation="hover"
          aria-hidden="true"
          data-sidebar-account-avatar
          data-account-orb-color={orbColor}
        /> : <span className={styles.avatar}><UserRound aria-hidden="true" className="size-4" /></span>}
        {loadingAccount ? <Skeleton className={styles.nameSkeleton} /> : <span className={styles.name} data-sidebar-account-name>{name}</span>}
        {signingOut ? <LoaderCircle aria-hidden="true" className={`${styles.chevron} animate-spin motion-reduce:animate-none`} /> : <ChevronDown aria-hidden="true" className={styles.chevron} />}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side={compact ? "right" : "top"} align={compact ? "end" : "start"} sideOffset={8} collisionPadding={12} className={styles.positioner}>
          <Menu.Popup
            className={styles.popup}
            data-sidebar-account-menu
            aria-label={labels.accountMenu}
            finalFocus={() => navigating.current ? false : triggerRef.current}
          >
            <Menu.RadioGroup value={language.locale}
              onValueChange={value => { if (value === "zh" || value === "en") language.setLocale(value); }}
              className="grid min-h-9 w-full grid-cols-2 rounded-lg bg-muted p-1 text-muted-foreground"
              aria-label={language.label} aria-busy={language.pending} data-sidebar-language-switch>
              {(["zh", "en"] as const).map(value => <Menu.RadioItem key={value} value={value} closeOnClick={false}
                disabled={language.pending || (value === "en" && !language.englishEnabled)}
                className="flex min-h-7 cursor-pointer items-center justify-center rounded-md px-1.5 text-xs font-medium whitespace-nowrap outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-checked:bg-background data-checked:text-foreground data-checked:shadow-sm data-disabled:pointer-events-none data-disabled:opacity-50 motion-reduce:transition-none">
                {value === "zh" ? "中文" : language.englishEnabled ? "EN" : "EN（关闭）"}
              </Menu.RadioItem>)}
            </Menu.RadioGroup>
            <Menu.Separator className={styles.separator} />
            {!session ? <Menu.LinkItem closeOnClick className={styles.item}
              onClick={event => navigate(event, "account")}
              render={(props, state) => <Link {...props} to={workbenchHref("account")} preload={false}>{renderItemContent(state.highlighted, props.children)}</Link>}
              data-sidebar-sign-in>
              <UserRound aria-hidden="true" />
              {labels.signInHint}
            </Menu.LinkItem> : null}
            {features.billing ? <Menu.LinkItem closeOnClick className={styles.item} aria-current={page === "billing" ? "page" : undefined}
              onClick={event => navigate(event, "billing")}
              render={(props, state) => <Link {...props} to={workbenchHref("billing")} preload={false}>{renderItemContent(state.highlighted, props.children)}</Link>}
              data-primary-navigation-page="billing">
              <CreditCard aria-hidden="true" />
              {labels.billing}
            </Menu.LinkItem> : null}
            <Menu.LinkItem closeOnClick className={styles.item} onClick={closeForNavigation}
              render={(props, state) => <Link {...props} to="/changelog" preload={false}>{renderItemContent(state.highlighted, props.children)}</Link>}
              data-changelog-link>
              <BookOpen aria-hidden="true" />
              {labels.changelog}
            </Menu.LinkItem>
            {session ? <>
              <Menu.Separator className={styles.separator} />
              <Menu.Item className={`${styles.item} ${styles.destructiveItem}`} closeOnClick={false} disabled={signingOut || isPending} onClick={() => void signOut()}
                render={(props, state) => <div {...props}>{renderItemContent(state.highlighted, props.children)}</div>}>
                {signingOut ? <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <LogOut aria-hidden="true" />}
                {signingOut ? labels.signingOut : labels.signOut}
              </Menu.Item>
            </> : null}
            {error ? <p role="alert" className={styles.error}>{error}</p> : null}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
    <div className={styles.actions}>
      <Link to="/docs" className={styles.iconButton} aria-label={labels.docs} title={labels.docs} data-docs-link onClick={closeForNavigation}>
        <CircleHelp aria-hidden="true" />
      </Link>
      <Link to={workbenchHref("settings")} preload={false} className={styles.iconButton} role="button"
        aria-label={labels.settings} title={labels.settings} aria-current={page === "settings" ? "page" : undefined}
        data-sidebar-settings-trigger data-primary-navigation-page="settings" onClick={event => navigate(event, "settings")}
        onKeyDown={event => { if (event.key === " ") event.preventDefault(); }}
        onKeyUp={event => { if (event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}>
        <Settings aria-hidden="true" />
      </Link>
    </div>
  </div>;
}
