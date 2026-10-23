"use client";
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

function formatMinute(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function orderStatus(status: string): { label: string; className: string } {
  if (status === "paid") return { label: "已付款 · 已到账", className: "text-emerald-600" };
  if (status === "cancelled" || status === "canceled") return { label: "已取消", className: "text-muted-foreground" };
  if (status === "refunded") return { label: "已退款", className: "text-amber-600" };
  return { label: "未付款 · 待支付", className: "text-amber-600" };
}

function BillingCard(props: ComponentProps<typeof WorkbenchCard>) {
  return <WorkbenchCard {...props} data-billing-card />;
}

function money(fen: number) {
  return `￥${(fen / 100).toLocaleString("zh-CN", { minimumFractionDigits: fen % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

const toolLabels: Record<string, string> = {
  agent_chat: "助理对话", solve_schedule: "基建排班", diagnose_account: "账号诊断",
  analyze_stock_and_training: "库存与培养分析", analyze_daily_production: "日产出分析",
  diagnose_account_health: "账号体检", query_skills: "基建技能查询",
};
const ledgerLabels: Record<string, string> = {
  topup: "充值到账", monthly_grant: "月卡到账", cdk_issue: "赠送兑换码",
  cdk_redeem: "兑换码到账", tool_charge: "工具扣费", tool_refund: "求解失败退还", token_settlement: "对话用量结算", agent_settlement: "助理用量结算",
};
const usageStatusLabels: Record<string, string> = {
  reserved: "待结算", completed: "已结算", completed_unsettled: "待补充积分",
  pending: "处理中", failed: "未完成",
};

async function readBilling(): Promise<BillingData> {
  const response = await fetch("/api/billing", { credentials: "same-origin", cache: "no-store" });
  const payload = await response.json() as { data?: BillingData; error?: { message?: string } };
  if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "计费数据暂不可用。");
  return payload.data;
}

export function BillingPrototype() {
  const locale = useLocale();
  const containerClass = `${styles.page} grid min-w-0 w-full content-start gap-4 pt-2 pb-8 md:gap-6 md:pt-5`;
  const heading = <WorkbenchPageHeading page="billing" accentColor="var(--billing-highlight)">{locale === "en" ? "Payment plans" : "付费计划"}</WorkbenchPageHeading>;
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
  const [notice, setNotice] = useState<string | null>(null);
  const [cdkCode, setCdkCode] = useState("");
  const redeemBusy = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      setData(await readBilling());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "计费数据暂不可用。");
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
      if (!response.ok) throw new Error(payload.error?.message ?? "清空失败，请重试。");
      setNotice(`已清空 ${payload.data?.deleted ?? 0} 笔未支付订单。`);
      notifyBillingUpdated();
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "清空失败，请重试。"); }
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
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "订单创建失败。");
      if (payload.data.paymentUrl) window.open(payload.data.paymentUrl, "_blank", "noopener,noreferrer");
      setNotice("订单已创建。请在爱发电完成支付，积分将自动到账。");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "订单创建失败。");
    } finally {
      setBusy(null);
    }
  };

  const simulatePaid = async (orderId: string) => {
    setBusy(orderId);
    try {
      const response = await fetch(`/api/billing/orders/${encodeURIComponent(orderId)}/simulate-paid`, { method: "POST", credentials: "same-origin" });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "模拟到账失败。");
      setNotice("模拟支付已到账，积分余额已更新。");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "模拟到账失败。");
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
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "兑换码操作失败。");
      setCdkCode("");
      const result = payload.data;
      setData(current => current ? { ...current, wallet: result.wallet } : current);
      setNotice(locale === "en" ? `Redeemed ${result.points} permanent credits.` : `兑换成功，已到账 ${result.points} 永久积分。`);
      notifyBillingUpdated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "兑换码操作失败。");
    } finally {
      redeemBusy.current = false;
      setBusy(null);
    }
  };

  if (error && !data) {
    return <section className={containerClass}>{heading}<div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm"><p>{error}</p><Button variant="outline" className={`${styles.pill} mt-3`} onClick={event => requestAccountSignIn(event.currentTarget)}>{locale === "en" ? "Sign in" : "登录网站账号"}</Button></div></section>;
  }
  if (!data) return <section className={containerClass}>{heading}<p role="status" className="py-8 text-center text-sm text-muted-foreground">正在加载积分账户……</p></section>;

  return (
    <section className={containerClass} data-billing-prototype>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>{heading}<p className="mt-2 text-sm text-muted-foreground">付费计划仅用于助理对话功能，基建计算器的求解功能保持免费。</p></div>
        <SetupActionButton nativeButton={false} variant="outline" className="!min-w-0 max-w-full max-md:!h-auto max-md:min-h-11 max-md:whitespace-normal max-md:!px-3 max-md:py-2" render={<Link to="/agent" />}>返回助理<ArrowUpRight className="size-3.5" /></SetupActionButton>
      </header>

      {notice ? <div role="status" className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">{notice}</div> : null}
      {error ? <div role="alert" className="rounded-xl bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div> : null}

      <BillingCard className={styles.wallet} aria-label="积分余额">
        <div className={styles.available}>
          <h2 className={styles.caption}>可用积分</h2>
          <p className={`${styles.balance} font-number`}>{formatPoints(data.wallet.totalPoints, locale)}<small>积分</small></p>
          {!!data.wallet.reservedPoints && <p className="mt-2 text-xs text-muted-foreground">{locale === "en" ? `${formatPoints(data.wallet.reservedPoints, locale)} points reserved for active requests` : `另有 ${formatPoints(data.wallet.reservedPoints, locale)} 积分用于进行中的请求，结算后释放剩余预留`}</p>}
          <p className={`${styles.caption} mt-3`}>仅用于助理对话 · 基建计算器求解免费</p>
        </div>
        <dl className={styles.walletDetails}>
          <div>
            <dt className={styles.caption}>永久积分</dt>
            <dd className={`${styles.balance} font-number`}>{formatPoints(data.wallet.paidPoints, locale)}</dd>
            <dd className={`${styles.caption} mt-2`}>长期有效</dd>
          </div>
          <div>
            <dt className={styles.caption}>月卡积分</dt>
            <dd className={`${styles.balance} font-number`}>{formatPoints(data.wallet.monthlyPoints, locale)}</dd>
            <dd className={`${styles.caption} mt-2`}>{data.wallet.monthlyExpiresAt ? `到期 ${new Date(data.wallet.monthlyExpiresAt).toLocaleDateString("zh-CN")}` : "暂无有效月卡"}</dd>
          </div>
        </dl>
      </BillingCard>

      <div className={styles.products} aria-label="积分套餐">
        {data.products.map((product) => (
          <BillingCard key={product.id} className={`${styles.product} ${product.id === "points_1_test" ? styles.testPack : product.kind === "monthly" ? styles.monthly : ""}`} glass>
            <div>
              <div className="flex items-start justify-between gap-3"><h2 className="text-sm font-semibold">{product.name}</h2>{product.badge ? <span className={`${styles.productBadge} shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium`}>{product.badge}</span> : null}</div>
              <p className={`${styles.price} font-number`}>{money(product.amountFen)}</p>
              <p className="mt-2 text-sm">{product.points.toLocaleString()} <span className="text-xs text-muted-foreground">积分</span></p>
            </div>
            <p className="text-xs leading-6 text-muted-foreground">{product.description}</p>
            <Button type="button" variant="outline" className={`${styles.pill} w-full`} disabled={busy !== null || !product.checkoutConfigured} onClick={() => void createOrder(product.id)}>{busy === product.id ? "创建中…" : product.checkoutConfigured ? "爱发电购买" : "待配置支付链接"}</Button>
          </BillingCard>
        ))}
      </div>

      <BillingCard id="billing-redeem" className={styles.redemption} aria-labelledby="billing-redeem-heading">
        <div><h2 id="billing-redeem-heading" className="text-sm font-semibold">{locale === "en" ? "Redeem a code" : "核销兑换码"}</h2><p className={`${styles.caption} mt-1`}>{locale === "en" ? "Each code can be redeemed once within its validity period, for permanent credits." : "每码限兑一次，请在有效期内兑换，到账后为永久积分。"}</p></div>
        <form className={styles.redemptionForm} onSubmit={(event) => { event.preventDefault(); if (busy === null && cdkCode.trim()) void cdkAction(); }}>
          <Input ref={codeInput} aria-label={locale === "en" ? "Credit code" : "积分兑换码"} placeholder="RIIC-..." maxLength={64} autoComplete="off" autoCapitalize="characters" spellCheck={false} value={cdkCode} onChange={(event) => setCdkCode(event.target.value)} />
          <Button type="submit" variant="outline" className={styles.pill} disabled={busy !== null || !cdkCode.trim()}>{busy === "cdk-redeem" ? "兑换中…" : "核销并入账"}</Button>
        </form>
      </BillingCard>

      <BillingCard aria-labelledby="billing-orders-heading" data-billing-orders>
        <div className={styles.sectionHeading}>
          <div className={styles.ordersTitle}>
            <h2 id="billing-orders-heading">最近订单</h2>
            <Button type="button" variant="link" size="sm" className={styles.clearOrders} disabled={busy !== null || !visibleOrders.some(order => order.status === "pending")}
              onMouseLeave={() => setConfirmClearOrders(false)} onBlur={() => setConfirmClearOrders(false)}
              onKeyDown={event => { if (event.key === "Escape") setConfirmClearOrders(false); }}
              onClick={() => { if (confirmClearOrders) void clearPendingOrders(); else setConfirmClearOrders(true); }}
            >{busy === "clear-pending-orders" ? "清空中…" : confirmClearOrders ? "确认清空所有未支付订单" : "一键清空未支付订单"}</Button>
          </div>
          <p className={styles.caption}>最近 6 笔 · 待支付订单 3 天后自动隐藏</p>
        </div>
        {visibleOrders.length === 0 ? <p className={styles.empty}>暂无可显示的订单，购买积分套餐后会显示在这里。</p> : <ul className={styles.records}>
          {visibleOrders.slice(0, 6).map((order) => {
            const status = orderStatus(order.status);
            return <li key={order.id} className={styles.row}>
              <div><h3 className={styles.recordTitle}>{data.products.find((product) => product.id === order.productId)?.name ?? order.productId}</h3><p className={styles.meta}>{order.points.toLocaleString()} 积分<span aria-hidden="true"> · </span><time dateTime={order.createdAt}>{formatMinute(order.createdAt)}</time></p></div>
              <div className="text-right"><p className={`${styles.amount} font-number`}>{money(order.amountFen)}</p><span className={`${styles.status} ${status.className}`}>{status.label}</span></div>
            </li>;
          })}
        </ul>}
        {activeOrder?.status === "pending" && data?.canSimulatePayment === true ? <div className={styles.recordFoot}><p className={styles.caption}>最近一笔订单待支付</p><Button type="button" variant="outline" className={styles.pill} disabled={busy !== null} onClick={() => void simulatePaid(activeOrder.id)}>{busy === activeOrder.id ? "处理中…" : "模拟爱发电回调到账"}</Button></div> : null}
      </BillingCard>

      <div className={styles.activity}>
        <BillingCard aria-labelledby="billing-usage-heading" data-billing-usage>
          <div className={styles.sectionHeading}><h2 id="billing-usage-heading">最近扣费</h2><p className={styles.caption}>最近 8 笔 · 点击查看明细</p></div>
          {data.usage.length === 0 ? <p className={styles.empty}>还没有扣费记录，使用助理后会显示在这里。</p> : <ul className={styles.records}>
            {data.usage.slice(0, 8).map((item) => <li key={item.id}>
              <details className={styles.usage}>
                <summary className={styles.row}>
                  <div><p className={styles.recordTitle}>{toolLabels[item.toolName] ?? item.toolName}</p><p className={styles.meta}><time dateTime={item.createdAt}>{formatMinute(item.createdAt)}</time></p>{item.status === "completed_unsettled" ? <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">部分费用待结算</p> : null}</div>
                  <div className={styles.usageTotal}><p className={`${styles.amount} font-number`}>{item.points > 0 ? "−" : ""}{formatPoints(item.points, locale)}<small>积分</small></p><ChevronDown className={styles.chevron} aria-hidden="true" /></div>
                </summary>
                <dl className={styles.breakdown}>
                  {item.toolFeePoints != null ? <div><dt>工具扣费</dt><dd>{formatPoints(item.toolFeePoints, locale)} 积分</dd></div> : null}
                  {item.tokenPoints != null ? <div><dt>Token 扣费</dt><dd>{formatPoints(item.tokenPoints, locale)} 积分</dd></div> : null}
                  <div><dt>结算状态</dt><dd>{usageStatusLabels[item.status] ?? "未知状态"}</dd></div>
                </dl>
              </details>
            </li>)}
          </ul>}
        </BillingCard>
        <BillingCard aria-labelledby="billing-ledger-heading" data-billing-ledger>
          <div className={styles.sectionHeading}><h2 id="billing-ledger-heading">积分账本</h2><p className={styles.caption}>最近 8 笔 · 积分收支</p></div>
          {data.ledger.length === 0 ? <p className={styles.empty}>充值或使用助理后，积分变动会显示在这里。</p> : <ul className={styles.records}>
            {data.ledger.slice(0, 8).map((item) => <li key={item.id} className={styles.row}>
              <div><h3 className={styles.recordTitle}>{ledgerLabels[item.kind] ?? "积分变动"}</h3><p className={styles.meta}><time dateTime={item.createdAt}>{formatMinute(item.createdAt)}</time></p></div>
              <p className={`${styles.amount} font-number ${item.pointsDelta > 0 ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{item.pointsDelta > 0 ? "+" : item.pointsDelta < 0 ? "−" : ""}{formatPoints(Math.abs(item.pointsDelta), locale)}<small>积分</small></p>
            </li>)}
          </ul>}
        </BillingCard>
      </div>
    </section>
  );
}
