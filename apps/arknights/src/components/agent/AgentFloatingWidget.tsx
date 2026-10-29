"use client";

import { lazyWithMessages } from "@/i18n/features-client";
import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../messages/zh-CN/AK_components_agent_AgentFloatingWidget.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_components_agent_AgentFloatingWidget");
import type { AppLocale } from "@riic/contracts/locale";
import { requestAccountSignIn } from "@riic/shell/account-sign-in";

import { Component, Suspense, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocale } from "use-intl";
import { Minus } from "lucide-react";
import { useWebsiteSession } from "@/website-session";
import { useFeatureAccess } from "@/components/workbench/FeatureAccessProvider";
import { useAgentHistory } from "@/hooks/use-agent-history";
import { subscribeBillingUpdates } from "@/lib/billing-events";
import { restoreAgentMessages } from "@/agent-history";
import { buildAutomaticScheduleContext, type AgentPageContext } from "@/agent-page-context";
import styles from "./AgentFloatingWidget.module.css";
import dockStyles from "../layout/WorkbenchDock.module.css";

type Availability = "checking" | "available" | "sign_in" | "credits" | "unavailable";
const AgentChat = lazyWithMessages(() => import("./AgentChat").then((module) => ({ default: module.AgentChat })), "apps/arknights/src/components/agent/AgentChat.tsx");

class AgentChatErrorBoundary extends Component<{ en: AppLocale; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <div className={styles.empty} role="alert">
      <p>{uiText.text(this.props.en, "conversationLoadFailed")}</p>
      <button type="button" className="text-primary underline underline-offset-4" onClick={() => window.location.reload()}>
        {uiText.text(this.props.en, "refreshPage")}
      </button>
    </div>;
  }
}

export function AgentFloatingWidget({ pageContext, automaticContextInput, minimized, onMinimizedChange, visible = true }: {
  pageContext: AgentPageContext | null;
  automaticContextInput?: Parameters<typeof buildAutomaticScheduleContext>[0];
  minimized: boolean;
  onMinimizedChange: (minimized: boolean) => void;
  visible?: boolean;
}) {
  const resolvedPageContext = useMemo(() => automaticContextInput ? buildAutomaticScheduleContext(automaticContextInput) : pageContext, [automaticContextInput, pageContext]);
  const locale = useLocale();
  const en = locale;
  const { data, isPending } = useWebsiteSession();
  const features = useFeatureAccess();
  const { ready, history } = useAgentHistory();
  const owner = data?.user.id ?? null;
  const previousOwner = useRef(owner);
  const panelId = useId();
  const floatingId = useId();
  const [availability, setAvailability] = useState<Availability>("checking");
  const [open, setOpen] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const dockRef = useRef<HTMLButtonElement>(null);
  const [sharePageContext, setSharePageContext] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (previousOwner.current === owner) return;
    previousOwner.current = owner;
    setOpen(false);
    setSharePageContext(true);
  }, [owner]);

  useEffect(() => {
    if (!visible || !features.agent) {
      setOpen(false);
      return;
    }
    if (isPending) {
      setAvailability("checking");
      return;
    }
    let active = true;
    let request: AbortController | undefined;
    const check = async () => {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      setAvailability((current) => current === "available" ? current : "checking");
      try {
        const response = await fetch("/api/agent/chat", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!active || controller.signal.aborted) return;
        if (response.ok) setAvailability("available");
        else if (response.status === 401) setAvailability("sign_in");
        else if (response.status === 402) setAvailability("credits");
        else setAvailability("unavailable");
      } catch {
        if (active && !controller.signal.aborted) setAvailability("unavailable");
      }
    };
    void check();
    const onFocus = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("focus", onFocus);
    const unsubscribe = subscribeBillingUpdates(() => void check());
    return () => {
      active = false;
      request?.abort();
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
  }, [features.agent, isPending, owner, visible]);

  if (!mounted || !visible || !features.agent) return null;
  const conversationId = history.activeId;
  const canChat = availability === "available" && features.agent;
  const lockedMessage = availability === "checking"
    ? (uiText.text(en, "checkingAssistantAccess"))
    : availability === "sign_in"
      ? (uiText.text(en, "signInToChatWithClosure"))
      : availability === "credits"
        ? (uiText.text(en, "addCreditsToStartAConversation"))
        : (uiText.text(en, "theAssistantIsTemporarilyUnavailable"));
  const lockedAction = availability === "sign_in"
    ? { href: null, label: uiText.text(en, "signIn") }
    : availability === "credits" && features.billing
      ? { href: "/billing", label: uiText.text(en, "viewCredits") }
      : null;
  const minimize = () => {
    setOpen(false);
    onMinimizedChange(true);
    dockRef.current?.focus({ preventScroll: true });
  };
  return (
    <div className={styles.root} data-agent-floating-widget data-minimized={minimized}>
      <button
        ref={dockRef}
        type="button"
        className={dockStyles.button}
        aria-label={minimized ? (uiText.text(en, "showFloatingAssistant")) : (uiText.text(en, "hideFloatingAssistant"))}
        aria-expanded={!minimized}
        aria-controls={minimized ? undefined : floatingId}
        title={minimized ? (uiText.text(en, "showFloatingAssistant")) : (uiText.text(en, "hideFloatingAssistant"))}
        onClick={() => {
          if (minimized) {
            onMinimizedChange(false);
            setOpen(true);
          } else {
            minimize();
          }
        }}
        data-agent-dock-trigger
      >
        <span className={styles.prtsCursor} aria-hidden="true" />
        <span>{uiText.text(en, "assistant")}</span>
      </button>
      {!minimized ? <div id={floatingId} className={styles.floating} data-agent-floating-surface>
      {open ? <section id={panelId} className={styles.panel} aria-label={uiText.text(en, "closureAssistant")} data-agent-floating-panel>
        {canChat && ready && conversationId ? <AgentChatErrorBoundary en={en}><Suspense fallback={<div className={styles.empty} role="status">{uiText.text(en, "openingConversation")}</div>}><AgentChat
          key={`${owner ?? "anonymous"}:${conversationId}:floating`}
          compact
          sharePageContext={sharePageContext}
          onSharePageContextChange={setSharePageContext}
          pageContext={resolvedPageContext}
          onClose={() => {
            setOpen(false);
            launcherRef.current?.focus({ preventScroll: true });
          }}
          billingAllowed={features.billing}
          userId={owner ?? undefined}
          userName={data?.user.name}
          conversationId={conversationId}
          initialMessages={restoreAgentMessages(history.conversations.find((entry) => entry.id === conversationId)?.messages ?? [])}
        /></Suspense></AgentChatErrorBoundary> : canChat ? <div className={styles.empty} role="status">{uiText.text(en, "openingConversation")}</div> : <div className={styles.locked} role="status">
          <img src="/icon.png" alt="" draggable={false} />
          <strong>{uiText.text(en, "closureAssistant")}</strong>
          <p>{lockedMessage}</p>
          {lockedAction ? lockedAction.href ? <a href={lockedAction.href}>{lockedAction.label}</a> : <button type="button" onClick={event => requestAccountSignIn(event.currentTarget)}>{lockedAction.label}</button> : null}
        </div>}
      </section> : null}
      {!open ? <span className={styles.hint} aria-hidden="true">{canChat ? (uiText.text(en, "whatWouldYouLikeToAskAboutThis")) : (uiText.text(en, "askClosureAboutThisPage"))}</span> : null}
      <button type="button" className={styles.minimize} aria-label={uiText.text(en, "minimizeFloatingAssistant")} title={uiText.text(en, "minimizeFloatingAssistant")} onClick={minimize}>
        <Minus size={14} aria-hidden="true" />
      </button>
      <button
        ref={launcherRef}
        type="button"
        className={styles.launcher}
        aria-label={open ? (uiText.text(en, "closeClosureAssistant")) : (uiText.text(en, "openClosureAssistant"))}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={open ? (uiText.text(en, "closeAssistant")) : (uiText.text(en, "askClosure"))}
        onClick={() => setOpen((value) => !value)}
        data-agent-floating-trigger
      >
        <span className={styles.launcherAvatar}><img src="/icon.png" alt="" draggable={false} /></span>
        <span className={styles.status} aria-hidden="true" />
      </button>
      </div> : null}
    </div>
  );
}
