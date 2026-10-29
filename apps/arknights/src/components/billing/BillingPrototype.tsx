"use client";
import { useLocale as useRawLocale } from "use-intl";
import { createLocalizer as createRawLocalizer, richValue } from "@riic/arknights-domain/i18n/localize";
import type RawMessages from "../../../messages/zh-CN/AK_Raw_components_billing_BillingPrototype.json";
const rawText = createRawLocalizer<typeof RawMessages>("AK_Raw_components_billing_BillingPrototype");


import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../messages/zh-CN/AK_components_billing_BillingPrototype.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_components_billing_BillingPrototype");

import type { AppLocale } from "@riic/contracts/locale";
import { formatPoints } from "@/billing-points";
import { WorkbenchPageHeading } from "@/components/workbench/WorkbenchPageHeading";
import { WorkbenchCard } from "@/components/workbench/WorkbenchCard";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { useLocale } from "use-intl";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestAccountSignIn } from "@riic/shell/account-sign-in";
import { SetupActionButton } from "@/components/setup/SetupActionButton";
import { Input } from "@/components/ui/input";
import styles from "./BillingPrototype.module.css";
import { notifyBillingUpdated, subscribeBillingUpdates } from "@/lib/billing-events";
import { isBillingOrderVisible } from "@/billing-order-visibility";

type Product = { id: string; name: string; amountFen: number; points: number; badge?: string; description: string; kind: string; checkoutConfigured: boolean };
type BillingData = {
  canSimulatePayment?: boolean;
  products: Product[];
  wallet: { paidPoints: number; monthlyPoints: number; monthlyExpiresAt: string | null; totalPoints: number; reservedPoints?: number };
  ledger: Array<{ id: string; kind: string; pointsDelta: number; createdAt: string; metadata?: Record<string, unknown> | null }>;
  orders: Array<{ id: string; productId: string; status: string; amountFen: number; points: number; paymentUrl: string | null; createdAt: string; paidAt: string | null }>;
  usage: Array<{ id: string; toolName: string; status: string; points: number; toolFeePoints?: number; tokenPoints?: number | null; inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null; upstreamCostRmb: number | null; chargedCostRmb: number | null; createdAt: string }>;
};

function formatMinute(value: string, locale: AppLocale): string {
  return new Date(value).toLocaleString(locale, {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function orderStatus(status: string, locale: AppLocale): { label: string; className: string } {
  if (status === "paid") return { label: uiText.text(locale, "paid"), className: "text-emerald-600" };
  if (status === "cancelled" || status === "canceled") return { label: uiText.text(locale, "cancelled"), className: "text-muted-foreground" };
  if (status === "refunded") return { label: uiText.text(locale, "refunded"), className: "text-amber-600" };
  return { label: uiText.text(locale, "unpaid"), className: "text-amber-600" };
}

function BillingCard(props: ComponentProps<typeof WorkbenchCard>) {
  return <WorkbenchCard {...props} data-billing-card />;
}

function money(fen: number, locale: AppLocale) {
  return `￥${(fen / 100).toLocaleString(locale, { minimumFractionDigits: fen % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

const toolLabels: Record<string, keyof typeof UiMessages> = {
  agent_chat: "agent_chat", solve_schedule: "solve_schedule", diagnose_account: "diagnose_account",
  analyze_stock_and_training: "analyze_stock_and_training", analyze_daily_production: "analyze_daily_production",
  diagnose_account_health: "diagnose_account_health", query_skills: "query_skills",
};
const ledgerLabels: Record<string, keyof typeof UiMessages> = {
  topup: "topup", monthly_grant: "monthly_grant", cdk_issue: "cdk_issue",
  cdk_redeem: "cdk_redeem", tool_charge: "tool_charge", tool_refund: "tool_refund", token_settlement: "token_settlement", agent_settlement: "agent_settlement",
};
const usageStatusLabels: Record<string, keyof typeof UiMessages> = {
  reserved: "reserved", completed: "completed", completed_unsettled: "completed_unsettled",
  pending: "pending", failed: "failed",
};

async function readBilling(): Promise<BillingData> {
  const response = await fetch("/api/billing", { credentials: "same-origin", cache: "no-store" });
  const payload = await response.json() as { data?: BillingData; error?: { message?: string } };
  if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "@billing:unavailable");
  return payload.data;
}

function errorMessage(error: string, locale: AppLocale) {
  const keys: Record<string, keyof typeof UiMessages> = {"@billing:unavailable":"unavailable","@billing:clearFailed":"clearFailed","@billing:orderFailed":"orderFailed","@billing:simulateFailed":"simulateFailed","@billing:redeemFailed":"redeemFailed"};
  return keys[error] ? uiText.text(locale, keys[error]) : error;
}

export function BillingPrototype() {
  const rawLocale = useRawLocale();
  const locale = useLocale();
  const containerClass = `${styles.page} grid min-w-0 w-full content-start gap-4 pt-2 pb-8 md:gap-6 md:pt-5`;
  const heading = <WorkbenchPageHeading page="billing" accentColor="var(--billing-highlight)">{uiText.text(locale, "paymentPlans")}</WorkbenchPageHeading>;
  const [data, setData] = useState<BillingData | null>(null);
  const [orderClock, setOrderClock] = useState(() => Date.now());
  const [confirmClearOrders, setConfirmClearOrders] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setOrderClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const visibleOrders = useMemo(() => data?.orders.filter(order => isBillingOrderVisible(order, orderClock)) ?? [], [data, orderClock]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ key: keyof typeof UiMessages; values?: Record<string, string | number> } | null>(null);
  const [cdkCode, setCdkCode] = useState("");
  const redeemBusy = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      setData(await readBilling());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "@billing:unavailable");
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => subscribeBillingUpdates(() => void reload()), [reload]);
  useEffect(() => {
    const readLink = () => {
      const value = new URLSearchParams(window.location.hash.slice(1)).get("redeem");
      if (!value || !/^[a-z0-9][a-z0-9_-]{7,63}$/i.test(value.trim())) return;
      setCdkCode(value.trim().toUpperCase());
      // Fragments stay out of server logs; remove the code from browser history
      // after prefilling. Redemption always requires an explicit submit.
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#billing-redeem`);
      codeInput.current?.focus();
    };
    readLink();
    window.addEventListener("hashchange", readLink);
    return () => window.removeEventListener("hashchange", readLink);
  }, []);

  // The API is ordered newest first; show the latest order so an older duplicate
  // pending order cannot hide a newer paid callback.
  const activeOrder = visibleOrders[0] ?? null;

  const clearPendingOrders = async () => {
    setConfirmClearOrders(false);
    setBusy("clear-pending-orders");
    setError(null);
    try {
      const response = await fetch("/api/billing", { method: "DELETE", credentials: "same-origin" });
      const payload = await response.json() as { data?: { deleted?: number }; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "@billing:clearFailed");
      setNotice({ key: "ordersCleared", values: { count: payload.data?.deleted ?? 0 } });
      notifyBillingUpdated();
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "@billing:clearFailed"); }
    finally { setBusy(null); }
  };

  useEffect(() => {
    if (!activeOrder || activeOrder.status !== "pending") return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/billing/orders/${encodeURIComponent(activeOrder.id)}`, { credentials: "same-origin", cache: "no-store" });
        const payload = await response.json() as { data?: { order?: { status?: string } } };
        if (!cancelled && payload.data?.order?.status === "paid") await reload();
      } catch {
        // 轮询失败不打断当前购买页，下一轮继续。
      }
    }, 5_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [activeOrder, reload]);

  const createOrder = async (productId: string) => {
    setBusy(productId);
    setNotice(null);
    try {
      const response = await fetch("/api/billing", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ productId, provider: "afdian" }),
      });
      const payload = await response.json() as { data?: { paymentUrl?: string; customOrderId?: string }; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "@billing:orderFailed");
      if (payload.data.paymentUrl) window.open(payload.data.paymentUrl, "_blank", "noopener,noreferrer");
      setNotice({ key: "orderCreated" });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "@billing:orderFailed");
    } finally {
      setBusy(null);
    }
  };

  const simulatePaid = async (orderId: string) => {
    setBusy(orderId);
    try {
      const response = await fetch(`/api/billing/orders/${encodeURIComponent(orderId)}/simulate-paid`, { method: "POST", credentials: "same-origin" });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "@billing:simulateFailed");
      setNotice({ key: "simulated" });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "@billing:simulateFailed");
    } finally {
      setBusy(null);
    }
  };

  const cdkAction = async () => {
    if (redeemBusy.current) return;
    redeemBusy.current = true;
    setBusy("cdk-redeem");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/billing/cdk", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "redeem", code: cdkCode.trim().toUpperCase() }),
      });
      const payload = await response.json() as { data?: { points: number; wallet: BillingData["wallet"] }; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "@billing:redeemFailed");
      setCdkCode("");
      const result = payload.data;
      setData(current => current ? { ...current, wallet: result.wallet } : current);
      setNotice({ key: "redeemedPermanentCredits", values: { value1: result.points } });
      notifyBillingUpdated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "@billing:redeemFailed");
    } finally {
      redeemBusy.current = false;
      setBusy(null);
    }
  };

  if (error && !data) {
    return <section className={containerClass}>{heading}<div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm"><p>{errorMessage(error, locale)}</p><Button variant="outline" className={`${styles.pill} mt-3`} onClick={event => requestAccountSignIn(event.currentTarget)}>{uiText.text(locale, "signIn")}</Button></div></section>;
  }
  if (!data) return <section className={containerClass}>{heading}<p role="status" className="py-8 text-center text-sm text-muted-foreground">{rawText.text(rawLocale, "loadingCreditAccount")}</p></section>;

  return (
    <section className={containerClass} data-billing-prototype>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>{heading}<p className="mt-2 text-sm text-muted-foreground">{rawText.text(rawLocale, "paidPlansApplyOnlyToAssistantConversationsSolvingSchedules")}</p></div>
        <SetupActionButton nativeButton={false} variant="outline" className="!min-w-0 max-w-full max-md:!h-auto max-md:min-h-11 max-md:whitespace-normal max-md:!px-3 max-md:py-2" render={<Link to="/agent" />}>{rawText.rich(rawLocale, "backToAssistant", { part1: richValue((<ArrowUpRight className="size-3.5" />)) })}</SetupActionButton>
      </header>

      {notice ? <div role="status" className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">{uiText.text(locale, notice.key, notice.values)}</div> : null}
      {error ? <div role="alert" className="rounded-xl bg-destructive/5 px-4 py-3 text-sm text-destructive">{errorMessage(error, locale)}</div> : null}

      <BillingCard className={styles.wallet} aria-label={rawText.text(rawLocale, "creditBalance")}>
        <div className={styles.available}>
          <h2 className={styles.caption}>{rawText.text(rawLocale, "availableCredits")}</h2>
          <p className={`${styles.balance} font-number`}>{formatPoints(data.wallet.totalPoints, locale)}<small>{rawText.text(rawLocale, "points")}</small></p>
          {!!data.wallet.reservedPoints && <p className="mt-2 text-xs text-muted-foreground">{uiText.text(locale, "pointsReservedForActiveRequests", { value1: formatPoints(data.wallet.reservedPoints, locale) })}</p>}
          <p className={`${styles.caption} mt-3`}>{rawText.text(rawLocale, "forAssistantConversationsOnlyBaseSchedulingIsFree")}</p>
        </div>
        <dl className={styles.walletDetails}>
          <div>
            <dt className={styles.caption}>{rawText.text(rawLocale, "permanentCredits")}</dt>
            <dd className={`${styles.balance} font-number`}>{formatPoints(data.wallet.paidPoints, locale)}</dd>
            <dd className={`${styles.caption} mt-2`}>{rawText.text(rawLocale, "noExpiry")}</dd>
          </div>
          <div>
            <dt className={styles.caption}>{rawText.text(rawLocale, "monthlyPassCredits")}</dt>
            <dd className={`${styles.balance} font-number`}>{formatPoints(data.wallet.monthlyPoints, locale)}</dd>
            <dd className={`${styles.caption} mt-2`}>{data.wallet.monthlyExpiresAt ? uiText.text(locale, "expires", { date: new Date(data.wallet.monthlyExpiresAt).toLocaleDateString(locale) }) : rawText.text(rawLocale, "noActiveMonthlyPass")}</dd>
          </div>
        </dl>
      </BillingCard>

      <div className={styles.products} aria-label={rawText.text(rawLocale, "creditPackages")}>
        {data.products.map((product) => (
          <BillingCard key={product.id} className={`${styles.product} ${product.id === "points_1_test" ? styles.testPack : product.kind === "monthly" ? styles.monthly : ""}`} glass>
            <div>
              <div className="flex items-start justify-between gap-3"><h2 className="text-sm font-semibold">{product.name}</h2>{product.badge ? <span className={`${styles.productBadge} shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium`}>{product.badge}</span> : null}</div>
              <p className={`${styles.price} font-number`}>{money(product.amountFen, locale)}</p>
              <p className="mt-2 text-sm">{product.points.toLocaleString(locale)} <span className="text-xs text-muted-foreground">{rawText.text(rawLocale, "points")}</span></p>
            </div>
            <p className="text-xs leading-6 text-muted-foreground">{product.description}</p>
            <Button type="button" variant="outline" className={`${styles.pill} w-full`} disabled={busy !== null || !product.checkoutConfigured} onClick={() => void createOrder(product.id)}>{busy === product.id ? rawText.text(rawLocale, "creating") : product.checkoutConfigured ? rawText.text(rawLocale, "buyOnAfdian") : rawText.text(rawLocale, "paymentLinkNotConfigured")}</Button>
          </BillingCard>
        ))}
      </div>

      <BillingCard id="billing-redeem" className={styles.redemption} aria-labelledby="billing-redeem-heading">
        <div><h2 id="billing-redeem-heading" className="text-sm font-semibold">{uiText.text(locale, "redeemACode")}</h2><p className={`${styles.caption} mt-1`}>{uiText.text(locale, "eachCodeCanBeRedeemedOnceWithinIts")}</p></div>
        <form className={styles.redemptionForm} onSubmit={(event) => { event.preventDefault(); if (busy === null && cdkCode.trim()) void cdkAction(); }}>
          <Input ref={codeInput} aria-label={uiText.text(locale, "creditCode")} placeholder="RIIC-..." maxLength={64} autoComplete="off" autoCapitalize="characters" spellCheck={false} value={cdkCode} onChange={(event) => setCdkCode(event.target.value)} />
          <Button type="submit" variant="outline" className={styles.pill} disabled={busy !== null || !cdkCode.trim()}>{busy === "cdk-redeem" ? rawText.text(rawLocale, "redeeming") : rawText.text(rawLocale, "redeemAndAddCredits")}</Button>
        </form>
      </BillingCard>

      <BillingCard aria-labelledby="billing-orders-heading" data-billing-orders>
        <div className={styles.sectionHeading}>
          <div className={styles.ordersTitle}>
            <h2 id="billing-orders-heading">{rawText.text(rawLocale, "recentOrders")}</h2>
            <Button type="button" variant="link" size="sm" className={styles.clearOrders} disabled={busy !== null || !visibleOrders.some(order => order.status === "pending")}
              onMouseLeave={() => setConfirmClearOrders(false)} onBlur={() => setConfirmClearOrders(false)}
              onKeyDown={event => { if (event.key === "Escape") setConfirmClearOrders(false); }}
              onClick={() => { if (confirmClearOrders) void clearPendingOrders(); else setConfirmClearOrders(true); }}
            >{busy === "clear-pending-orders" ? rawText.text(rawLocale, "clearing") : confirmClearOrders ? rawText.text(rawLocale, "confirmClearingAllUnpaidOrders") : rawText.text(rawLocale, "clearAllUnpaidOrders")}</Button>
          </div>
          <p className={styles.caption}>{rawText.text(rawLocale, "latest6UnpaidOrdersAreHiddenAfter3Days")}</p>
        </div>
        {visibleOrders.length === 0 ? <p className={styles.empty}>{rawText.text(rawLocale, "noOrdersToShowCreditPackagePurchasesWillAppear")}</p> : <ul className={styles.records}>
          {visibleOrders.slice(0, 6).map((order) => {
            const status = orderStatus(order.status, locale);
            return <li key={order.id} className={styles.row}>
              <div><h3 className={styles.recordTitle}>{data.products.find((product) => product.id === order.productId)?.name ?? order.productId}</h3><p className={styles.meta}>{rawText.rich(rawLocale, "credits", { part1: richValue((order.points.toLocaleString(locale))), part2: richValue((<span aria-hidden="true"> · </span>)), part3: richValue((<time dateTime={order.createdAt}>{formatMinute(order.createdAt, locale)}</time>)) })}</p></div>
              <div className="text-right"><p className={`${styles.amount} font-number`}>{money(order.amountFen, locale)}</p><span className={`${styles.status} ${status.className}`}>{status.label}</span></div>
            </li>;
          })}
        </ul>}
        {activeOrder?.status === "pending" && data?.canSimulatePayment === true ? <div className={styles.recordFoot}><p className={styles.caption}>{rawText.text(rawLocale, "yourLatestOrderIsAwaitingPayment")}</p><Button type="button" variant="outline" className={styles.pill} disabled={busy !== null} onClick={() => void simulatePaid(activeOrder.id)}>{busy === activeOrder.id ? rawText.text(rawLocale, "saving") : rawText.text(rawLocale, "simulateAfdianPaymentCallback")}</Button></div> : null}
      </BillingCard>

      <div className={styles.activity}>
        <BillingCard aria-labelledby="billing-usage-heading" data-billing-usage>
          <div className={styles.sectionHeading}><h2 id="billing-usage-heading">{rawText.text(rawLocale, "recentCharges")}</h2><p className={styles.caption}>{rawText.text(rawLocale, "latest8SelectToViewDetails")}</p></div>
          {data.usage.length === 0 ? <p className={styles.empty}>{rawText.text(rawLocale, "noChargesYetTheyWillAppearAfterYouUse")}</p> : <ul className={styles.records}>
            {data.usage.slice(0, 8).map((item) => <li key={item.id}>
              <details className={styles.usage}>
                <summary className={styles.row}>
                  <div><p className={styles.recordTitle}>{toolLabels[item.toolName] ? uiText.text(locale, toolLabels[item.toolName]) : item.toolName}</p><p className={styles.meta}><time dateTime={item.createdAt}>{formatMinute(item.createdAt, locale)}</time></p>{item.status === "completed_unsettled" ? <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">{rawText.text(rawLocale, "someChargesArePendingSettlement")}</p> : null}</div>
                  <div className={styles.usageTotal}><p className={`${styles.amount} font-number`}>{item.points > 0 ? "−" : ""}{formatPoints(item.points, locale)}<small>{rawText.text(rawLocale, "points")}</small></p><ChevronDown className={styles.chevron} aria-hidden="true" /></div>
                </summary>
                <dl className={styles.breakdown}>
                  {item.toolFeePoints != null ? <div><dt>{rawText.text(rawLocale, "toolCharges")}</dt><dd>{rawText.rich(rawLocale, "credits2", { part1: richValue((formatPoints(item.toolFeePoints, locale))) })}</dd></div> : null}
                  {item.tokenPoints != null ? <div><dt>{rawText.text(rawLocale, "tokenCharges")}</dt><dd>{rawText.rich(rawLocale, "credits2", { part1: richValue((formatPoints(item.tokenPoints, locale))) })}</dd></div> : null}
                  <div><dt>{rawText.text(rawLocale, "settlementStatus")}</dt><dd>{usageStatusLabels[item.status] ? uiText.text(locale, usageStatusLabels[item.status]) : rawText.text(rawLocale, "unknownStatus")}</dd></div>
                </dl>
              </details>
            </li>)}
          </ul>}
        </BillingCard>
        <BillingCard aria-labelledby="billing-ledger-heading" data-billing-ledger>
          <div className={styles.sectionHeading}><h2 id="billing-ledger-heading">{rawText.text(rawLocale, "creditLedger")}</h2><p className={styles.caption}>{rawText.text(rawLocale, "latest8CreditsReceivedAndSpent")}</p></div>
          {data.ledger.length === 0 ? <p className={styles.empty}>{rawText.text(rawLocale, "creditChangesWillAppearAfterYouTopUpOr")}</p> : <ul className={styles.records}>
            {data.ledger.slice(0, 8).map((item) => <li key={item.id} className={styles.row}>
              <div><h3 className={styles.recordTitle}>{ledgerLabels[item.kind] ? uiText.text(locale, ledgerLabels[item.kind]) : rawText.text(rawLocale, "creditChange")}</h3><p className={styles.meta}><time dateTime={item.createdAt}>{formatMinute(item.createdAt, locale)}</time></p></div>
              <p className={`${styles.amount} font-number ${item.pointsDelta > 0 ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{item.pointsDelta > 0 ? "+" : item.pointsDelta < 0 ? "−" : ""}{formatPoints(Math.abs(item.pointsDelta), locale)}<small>{rawText.text(rawLocale, "points")}</small></p>
            </li>)}
          </ul>}
        </BillingCard>
      </div>
    </section>
  );
}
