export type BillingProductKind = "topup" | "monthly";

export interface BillingProduct {
  id: string;
  name: string;
  kind: BillingProductKind;
  amountFen: number;
  points: number;
  durationDays?: number;
  badge?: string;
  description: string;
}

/**
 * 人民币积分产品。积分是站内服务额度，不与任何上游模型的美元报价直接混用。
 * 月卡额度单独计桶，默认 30 天有效且不跨月滚存。
 */
export const BILLING_PRODUCTS: readonly BillingProduct[] = [
  {
    id: "points_1_test",
    name: "1 元测试包",
    kind: "topup",
    amountFen: 100,
    points: 10,
    badge: "联调测试",
    description: "一次性到账 10 积分，仅用于支付联调。",
  },
  {
    id: "points_5",
    name: "5 元积分包",
    kind: "topup",
    amountFen: 500,
    points: 50,
    description: "一次性到账 50 积分，永久有效。",
  },
  {
    id: "points_10",
    name: "10 元积分包",
    kind: "topup",
    amountFen: 1_000,
    points: 110,
    badge: "赠 10 积分",
    description: "一次性到账 110 积分，永久有效。",
  },
  {
    id: "monthly_19_9",
    name: "19.9 元月卡",
    kind: "monthly",
    amountFen: 1_990,
    points: 300,
    durationDays: 30,
    badge: "月卡",
    description: "30 天内可用 300 积分，到期未用额度不滚存。",
  },
] as const;

export const SOLVE_TOOL_POINTS = 1;
export const POINT_VALUE_RMB = 0.1;

export function billingProduct(productId: string): BillingProduct | null {
  return BILLING_PRODUCTS.find((product) => product.id === productId) ?? null;
}

export function billingTestProductEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" || env.BILLING_PROTOTYPE_MODE === "1";
}

const AFDIAN_URL_ENV: Record<string, string> = {
  points_1_test: "AFDIAN_PAYMENT_URL_POINTS_1_TEST",
  points_5: "AFDIAN_PAYMENT_URL_POINTS_5",
  points_10: "AFDIAN_PAYMENT_URL_POINTS_10",
  monthly_19_9: "AFDIAN_PAYMENT_URL_MONTHLY_19_9",
};

/** Each price must have its own Afdian item/plan; query parameters do not select a price. */
export function afdianCheckoutUrl(productId: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env[AFDIAN_URL_ENV[productId]]?.trim()
    || (productId === "points_5" ? env.AFDIAN_TEST_PAYMENT_URL?.trim() : undefined);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !["afdian.com", "www.afdian.com", "afdian.net", "www.afdian.net"].includes(url.hostname)) return null;
    if (!/^\/(item|plan)\/[a-z0-9]+\/?$/i.test(url.pathname)) return null;
    for (const otherProductId of Object.keys(AFDIAN_URL_ENV)) {
      if (otherProductId === productId) continue;
      const otherRaw = env[AFDIAN_URL_ENV[otherProductId]]?.trim()
        || (otherProductId === "points_5" ? env.AFDIAN_TEST_PAYMENT_URL?.trim() : undefined);
      if (!otherRaw) continue;
      const otherUrl = new URL(otherRaw);
      if (otherUrl.origin === url.origin && otherUrl.pathname.replace(/\/$/, "") === url.pathname.replace(/\/$/, "")) return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function formatRmb(amountFen: number): string {
  return `￥${(amountFen / 100).toFixed(2).replace(/\.00$/, "")}`;
}
