"use client";

import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../messages/zh-CN/AK_components_agent_AgentCreditBalance.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_components_agent_AgentCreditBalance");
import type { AppLocale } from "@riic/contracts/locale";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Coins } from "lucide-react";
import { subscribeBillingUpdates } from "@/lib/billing-events";
import { formatPoints } from "@/billing-points";

export function AgentCreditBalance({ enabled, busy, en }: { enabled: boolean; busy: boolean; en: AppLocale }) {
  const [points, setPoints] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled || busy) return;
    let request: AbortController | undefined;
    const refresh = async () => {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      try {
        const response = await fetch("/api/billing", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        const payload = await response.json() as { data?: { wallet?: { totalPoints?: unknown } } };
        const total = payload.data?.wallet?.totalPoints;
        if (!controller.signal.aborted) setPoints(response.ok && typeof total === "number" && Number.isFinite(total) ? total : null);
      } catch {
        if (!controller.signal.aborted) setPoints(null);
      }
    };
    const focus = () => { if (document.visibilityState === "visible") void refresh(); };
    void refresh();
    window.addEventListener("focus", focus);
    const unsubscribe = subscribeBillingUpdates(() => void refresh());
    return () => { request?.abort(); window.removeEventListener("focus", focus); unsubscribe(); };
  }, [enabled, busy]);

  if (!enabled) return null;
  const balance = points === null ? "—" : formatPoints(points, en === "en" ? "en-US" : "zh-CN");
  return <Link to="/billing" data-agent-credit-balance aria-label={`${uiText.text(en, "creditsLeft")} ${balance}`} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
    <Coins className="size-3.5 md:hidden" aria-hidden="true" />
    <span className="max-md:sr-only">{uiText.text(en, "creditsLeft")}</span>
    <span className="font-number font-medium tabular-nums text-foreground">{balance}</span>
  </Link>;
}
