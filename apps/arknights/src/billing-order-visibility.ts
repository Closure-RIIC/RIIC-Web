export const PENDING_ORDER_VISIBLE_MS = 3 * 24 * 60 * 60 * 1000;

export function isBillingOrderVisible(order: { status: string; createdAt: string; hiddenAt?: string | null }, now = Date.now()): boolean {
  return order.status !== "pending" || (!order.hiddenAt && new Date(order.createdAt).getTime() + PENDING_ORDER_VISIBLE_MS > now);
}
