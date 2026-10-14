import "@tanstack/react-start/server-only";

import { createHash } from "node:crypto";

export type AfdianOrder = {
  out_trade_no?: string;
  custom_order_id?: string;
  user_id?: string;
  plan_id?: string;
  total_amount?: string | number;
  status?: number;
  remark?: string;
  product_type?: number;
  sku_detail?: unknown[];
};

type AfdianApiResponse = {
  ec?: number;
  em?: string;
  data?: { list?: AfdianOrder[]; total_page?: number; total_count?: number };
};

export class AfdianApiError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AfdianApiError";
  }
}

function apiConfig() {
  const token = process.env.AFDIAN_API_TOKEN?.trim() ?? "";
  const userId = process.env.AFDIAN_USER_ID?.trim() ?? "";
  if (!token || !userId) return null;
  return {
    token,
    userId,
    endpoint: process.env.AFDIAN_API_BASE_URL?.trim() || "https://afdian.net/api/open/query-order",
  };
}

function signRequest(token: string, userId: string, params: string, ts: number): string {
  return createHash("md5").update(`${token}params${params}ts${ts}user_id${userId}`).digest("hex");
}

export function afdianApiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.AFDIAN_API_TOKEN?.trim() && env.AFDIAN_USER_ID?.trim());
}

export async function queryAfdianOrders(input: { page?: number; outTradeNo?: string } = {}): Promise<AfdianApiResponse["data"]> {
  const config = apiConfig();
  if (!config) throw new AfdianApiError("爱发电主动查询尚未配置创作者 user_id。");
  const paramsObject = input.outTradeNo
    ? { out_trade_no: input.outTradeNo }
    : { page: Math.max(1, Math.floor(input.page ?? 1)) };
  const params = JSON.stringify(paramsObject);
  const ts = Math.floor(Date.now() / 1000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: config.userId, params, ts, sign: signRequest(config.token, config.userId, params, ts) }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new AfdianApiError(`爱发电主动查询返回 HTTP ${response.status}。`);
    const payload = await response.json() as AfdianApiResponse;
    if (payload.ec !== 200) throw new AfdianApiError(`爱发电主动查询失败（${payload.ec ?? "unknown"}）。`);
    return payload.data ?? { list: [] };
  } catch (error) {
    if (error instanceof AfdianApiError) throw error;
    throw new AfdianApiError("爱发电主动查询暂时失败。", { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

export async function findAfdianOrderByOutTradeNo(outTradeNo: string): Promise<AfdianOrder | null> {
  const data = await queryAfdianOrders({ outTradeNo });
  return data?.list?.find((item) => item.out_trade_no === outTradeNo) ?? null;
}
