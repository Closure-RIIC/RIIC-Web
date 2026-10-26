"use client";

import { cloneElement, useId, useRef, useState, type ComponentPropsWithRef, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { BookOpen, ChevronDown, CircleHelp, CreditCard, Gift, LoaderCircle, LogOut, Settings, UserRound } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { FluidOrb } from "@riic/ui-primitives/fluid-orb";
import { Skeleton } from "@riic/ui-primitives/skeleton";
import { useSidebar } from "@riic/ui-primitives/sidebar";
import { accountOrbColor } from "./account-orb";
import styles from "./SidebarAccountMenu.module.css";

export type AccountMenuDestination = "billing" | "referral" | "changelog" | "docs" | "settings";
type AccountLink = ReactElement<ComponentPropsWithRef<"a">>;

function FooterLink({ link, ...props }: ComponentPropsWithRef<"a"> & { link: AccountLink }) {
  return cloneElement(link, props);
}

const copy = {
  zh: { menu: "账号菜单", anonymous: "未登录", signIn: "登录网站账号", loading: "正在加载账号", billing: "付费计划", referral: "邀请返利", changelog: "更新日志", signOut: "退出登录", signingOut: "正在退出…", signOutFailed: "退出登录失败，请重试。", docs: "Docs", settings: "设置", language: "语言", englishDisabled: "EN（关闭）", unavailable: "账号服务暂不可用，本地排班仍可使用。" },
  en: { menu: "Account menu", anonymous: "Not signed in", signIn: "Sign in to your account", loading: "Loading account", billing: "Payment plans", referral: "Invite friends", changelog: "Changelog", signOut: "Sign out", signingOut: "Signing out…", signOutFailed: "Could not sign out. Please try again.", docs: "Docs", settings: "Settings", language: "Language", englishDisabled: "EN (disabled)", unavailable: "Account service unavailable. Local scheduling still works." },
};

/** Both apps provide their own router links and account actions; menu behavior stays shared. */
export function SidebarAccountMenu({ user, pending, busy = false, unavailable = false, language, billingEnabled = false, links, currentPage, onNavigate, onSignIn, onSignOut }: {
  user?: { id: string; name: string };
  pending: boolean;
  busy?: boolean;
  unavailable?: boolean;
  language: { locale: string; pending?: boolean; englishEnabled?: boolean; setLocale: (locale: "zh" | "en") => void };
  billingEnabled?: boolean;
  links: Record<Exclude<AccountMenuDestination, "billing" | "referral">, AccountLink> & { billing?: AccountLink; referral?: AccountLink };
  currentPage?: string;
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, destination: AccountMenuDestination, trigger: HTMLElement | null) => void;
  onSignIn: (trigger: HTMLElement) => void;
  onSignOut: () => Promise<void>;
}) {
  const labels = copy[language.locale === "en" ? "en" : "zh"];
  const billingLink = links.billing;
  const referralLink = links.referral;
  const { state, isMobile, setOpenMobile } = useSidebar();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navigating = useRef(false);
  const signOutPending = useRef(false);
  const highlightId = useId();
  const reducedMotion = useReducedMotion();
  const compact = state === "collapsed" && !isMobile;
  const loadingAccount = pending && !user;
  const name = user ? user.name.trim() || "RIIC" : labels.anonymous;
  const orbColor = user ? accountOrbColor(user.id) : undefined;

  function renderItemContent(highlighted: boolean, children: ReactNode) {
    return <>
      {highlighted ? <motion.span aria-hidden="true" className={styles.highlight} data-account-menu-highlight
        layoutId={highlightId} initial={false} transition={{ duration: reducedMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }} /> : null}
      <span className={styles.itemContent}>{children}</span>
    </>;
  }

  function closeForNavigation() {
    navigating.current = true;
    setOpen(false);
    if (isMobile) setOpenMobile(false);
  }

  function navigate(event: MouseEvent<HTMLAnchorElement>, destination: AccountMenuDestination) {
    onNavigate?.(event, destination, triggerRef.current);
    closeForNavigation();
  }

  async function signOut() {
    if (signOutPending.current || busy || pending) return;
    signOutPending.current = true;
    setSigningOut(true);
    setError(false);
    try {
      await onSignOut();
      closeForNavigation();
    } catch {
      setError(true);
    } finally {
      signOutPending.current = false;
      setSigningOut(false);
    }
  }

  const triggerContent = <>
    {loadingAccount ? <Skeleton className={styles.avatar} /> : user ? <FluidOrb size={24} color={orbColor} animation="hover"
      aria-hidden="true" data-sidebar-account-avatar data-account-orb-color={orbColor} /> : <span className={styles.avatar}><UserRound aria-hidden="true" className="size-4" /></span>}
    {loadingAccount ? <Skeleton className={styles.nameSkeleton} /> : <span className={styles.name} data-sidebar-account-name>{name}</span>}
    {signingOut ? <LoaderCircle aria-hidden="true" className={`${styles.chevron} animate-spin motion-reduce:animate-none`} /> : user ? <ChevronDown aria-hidden="true" className={styles.chevron} /> : null}
  </>;
  const triggerProps = {
    ref: triggerRef, className: styles.card, "data-sidebar-account-trigger": true,
    "aria-label": loadingAccount ? labels.loading : user ? `${labels.menu}: ${name}` : labels.signIn,
    "aria-busy": pending || signingOut || undefined,
    title: unavailable ? labels.unavailable : loadingAccount ? labels.loading : name,
  };

  return <div className={styles.footer} data-sidebar-account-footer data-compact={compact || undefined}>
    <Menu.Root open={open && Boolean(user)} onOpenChange={next => {
      if (next) { navigating.current = false; setError(false); }
      setOpen(next);
    }}>
      {user ? <Menu.Trigger {...triggerProps}>{triggerContent}</Menu.Trigger> : <button {...triggerProps} type="button" disabled={loadingAccount}
        data-sidebar-sign-in onClick={event => { closeForNavigation(); onSignIn(event.currentTarget); }}>{triggerContent}</button>}
      {user ? <Menu.Portal><Menu.Positioner side={compact ? "right" : "top"} align={compact ? "end" : "start"} sideOffset={8} collisionPadding={12} className={styles.positioner}>
        <Menu.Popup className={styles.popup} data-sidebar-account-menu aria-label={labels.menu} finalFocus={() => navigating.current ? false : triggerRef.current}>
          <Menu.RadioGroup value={language.locale} onValueChange={value => { if (value === "zh" || value === "en") language.setLocale(value); }}
            className={styles.language} aria-label={labels.language} aria-busy={language.pending} data-sidebar-language-switch>
            {(["zh", "en"] as const).map(value => <Menu.RadioItem key={value} value={value} closeOnClick={false}
              disabled={language.pending || (value === "en" && language.englishEnabled === false)} className={styles.languageItem}>
              {value === "zh" ? "中文" : language.englishEnabled === false ? labels.englishDisabled : "EN"}
            </Menu.RadioItem>)}
          </Menu.RadioGroup>
          <Menu.Separator className={styles.separator} />
          {billingEnabled && billingLink ? <Menu.LinkItem closeOnClick className={styles.item} aria-current={currentPage === "billing" ? "page" : undefined}
            onClick={event => navigate(event, "billing")} data-primary-navigation-page="billing"
            render={(props, state) => cloneElement(billingLink, props, renderItemContent(state.highlighted, props.children))}>
            <CreditCard aria-hidden="true" />{labels.billing}
          </Menu.LinkItem> : null}
          {referralLink ? <Menu.LinkItem closeOnClick className={styles.item} aria-current={currentPage === "referral" ? "page" : undefined}
            onClick={event => navigate(event, "referral")} data-primary-navigation-page="referral"
            render={(props, state) => cloneElement(referralLink, props, renderItemContent(state.highlighted, props.children))}>
            <Gift aria-hidden="true" />{labels.referral}
          </Menu.LinkItem> : null}
          <Menu.LinkItem closeOnClick className={styles.item} onClick={event => navigate(event, "changelog")} data-changelog-link
            render={(props, state) => cloneElement(links.changelog, props, renderItemContent(state.highlighted, props.children))}>
            <BookOpen aria-hidden="true" />{labels.changelog}
          </Menu.LinkItem>
          <Menu.Separator className={styles.separator} />
          <Menu.Item className={`${styles.item} ${styles.destructiveItem}`} closeOnClick={false} disabled={signingOut || busy || pending} onClick={() => void signOut()}
            render={(props, state) => <div {...props}>{renderItemContent(state.highlighted, props.children)}</div>}>
            {signingOut ? <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <LogOut aria-hidden="true" />}
            {signingOut ? labels.signingOut : labels.signOut}
          </Menu.Item>
          {error || unavailable ? <p role="alert" className={styles.error}>{error ? labels.signOutFailed : labels.unavailable}</p> : null}
        </Menu.Popup>
      </Menu.Positioner></Menu.Portal> : null}
    </Menu.Root>
    <div className={styles.actions}>
      <FooterLink link={links.docs} className={styles.iconButton} aria-label={labels.docs} title={labels.docs}
        onClick={event => navigate(event, "docs")}><CircleHelp aria-hidden="true" /></FooterLink>
      <FooterLink link={links.settings} className={styles.iconButton} role="button" aria-label={labels.settings} title={labels.settings}
        aria-current={currentPage === "settings" ? "page" : undefined}
        data-sidebar-settings-trigger data-primary-navigation-page="settings"
        onClick={event => navigate(event, "settings")}
        onKeyDown={event => { if (event.key === " ") event.preventDefault(); }}
        onKeyUp={event => { if (event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
      ><Settings aria-hidden="true" /></FooterLink>
    </div>
  </div>;
}
