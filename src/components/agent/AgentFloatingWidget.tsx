"use client";

import { Component, lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "use-intl";
import { Minus } from "lucide-react";
import { useWebsiteSession } from "@/website-session";
import { useFeatureAccess } from "@/components/workbench/FeatureAccessProvider";
import { useAgentHistory } from "@/hooks/use-agent-history";
import { subscribeBillingUpdates } from "@/lib/billing-events";
import { restoreAgentMessages } from "@/agent-history";
import { buildAutomaticScheduleContext, type AgentPageContext } from "@/agent-page-context";
import styles from "./AgentFloatingWidget.module.css";

type Availability = "checking" | "available" | "sign_in" | "credits" | "unavailable";
const AgentChat = lazy(() => import("./AgentChat").then((module) => ({ default: module.AgentChat })));

class AgentChatErrorBoundary extends Component<{ en: boolean; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <div className={styles.empty} role="alert">
      <p>{this.props.en ? "The conversation could not load. Refresh the page to try again." : "对话加载失败，请刷新页面后重试。"}</p>
      <button type="button" className="text-primary underline underline-offset-4" onClick={() => window.location.reload()}>
        {this.props.en ? "Refresh page" : "刷新页面"}
      </button>
    </div>;
  }
}

export function AgentFloatingWidget({ pageContext, automaticContextInput, visible = true }: {
  pageContext: AgentPageContext | null;
  automaticContextInput?: Parameters<typeof buildAutomaticScheduleContext>[0];
  visible?: boolean;
}) {
  const resolvedPageContext = useMemo(() => automaticContextInput ? buildAutomaticScheduleContext(automaticContextInput) : pageContext, [automaticContextInput, pageContext]);
  const locale = useLocale();
  const en = locale === "en";
  const { data, isPending } = useWebsiteSession();
  const features = useFeatureAccess();
  const { ready, history } = useAgentHistory();
  const owner = data?.user.id ?? null;
  const previousOwner = useRef(owner);
  const panelId = useId();
  const [availability, setAvailability] = useState<Availability>("checking");
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
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
    ? (en ? "Checking assistant access…" : "正在检查助理状态…")
    : availability === "sign_in"
      ? (en ? "Sign in to chat with Closure." : "登录后即可和可露希尔对话。")
      : availability === "credits"
        ? (en ? "Add credits to start a conversation." : "准备积分后即可开始对话。")
        : (en ? "The assistant is temporarily unavailable." : "助理暂时不可用，请稍后再试。");
  const lockedAction = availability === "sign_in"
    ? { href: "/account", label: en ? "Sign in" : "前往登录" }
    : availability === "credits" && features.billing
      ? { href: "/billing", label: en ? "View credits" : "查看积分" }
      : null;
  return createPortal(
    <div className={styles.root} data-agent-floating-widget data-minimized={minimized}>
      {open ? <section id={panelId} className={styles.panel} aria-label={en ? "Closure Assistant" : "可露希尔助理"} data-agent-floating-panel>
        {canChat && ready && conversationId ? <AgentChatErrorBoundary en={en}><Suspense fallback={<div className={styles.empty} role="status">{en ? "Opening conversation…" : "正在打开对话…"}</div>}><AgentChat
          key={`${owner ?? "anonymous"}:${conversationId}:floating`}
          compact
          sharePageContext={sharePageContext}
          onSharePageContextChange={setSharePageContext}
          pageContext={resolvedPageContext}
          onClose={() => setOpen(false)}
          billingAllowed={features.billing}
          userId={owner ?? undefined}
          userName={data?.user.name}
          conversationId={conversationId}
          initialMessages={restoreAgentMessages(history.conversations.find((entry) => entry.id === conversationId)?.messages ?? [])}
        /></Suspense></AgentChatErrorBoundary> : canChat ? <div className={styles.empty} role="status">{en ? "Opening conversation…" : "正在打开对话…"}</div> : <div className={styles.locked} role="status">
          <img src="/icon.png" alt="" draggable={false} />
          <strong>{en ? "Closure Assistant" : "可露希尔助理"}</strong>
          <p>{lockedMessage}</p>
          {lockedAction ? <a href={lockedAction.href}>{lockedAction.label}</a> : null}
        </div>}
      </section> : null}
      {!open && !minimized ? <>
        <span className={styles.hint} aria-hidden="true">{canChat ? (en ? "What would you like to ask about this page?" : "博士，这页有什么想问的？") : (en ? "Ask Closure about this page" : "点击查看可露希尔助理")}</span>
        <button type="button" className={styles.minimize} aria-label={en ? "Minimize floating assistant" : "收起悬浮助理"} title={en ? "Minimize floating assistant" : "收起悬浮助理"} onClick={() => setMinimized(true)}>
          <Minus size={14} aria-hidden="true" />
        </button>
      </> : null}
      <button
        type="button"
        className={styles.launcher}
        aria-label={open ? (en ? "Close Closure Assistant" : "收起可露希尔助理") : (en ? "Open Closure Assistant" : "打开可露希尔助理")}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={open ? (en ? "Close assistant" : "收起助理") : (en ? "Ask Closure" : "和可露希尔聊聊")}
        onClick={() => {
          setMinimized(false);
          setOpen((value) => !value);
        }}
        data-agent-floating-trigger
      >
        <span className={styles.launcherAvatar}><img src="/icon.png" alt="" draggable={false} /></span>
        <span className={styles.status} aria-hidden="true" />
      </button>
    </div>,
    document.body,
  );
}
