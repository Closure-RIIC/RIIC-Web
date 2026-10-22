import { AsyncLocalStorage } from "node:async_hooks";
import { parseCookie } from "cookie";

type RequestContext = { request: Request; memo: Map<string, unknown> };
const context = new AsyncLocalStorage<RequestContext>();

export function withPlatformRequest<T>(request: Request, run: () => T): T {
  return context.run({ request, memo: new Map() }, run);
}

export function getRequestHeaders(): Headers {
  const value = context.getStore();
  if (!value) throw new Error("Platform request context is missing");
  return value.request.headers;
}

export function getCookies(): Record<string, string> {
  return Object.fromEntries(Object.entries(parseCookie(getRequestHeaders().get("cookie") ?? "")).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

/** Deduplicate work only within this request; never share identities across requests. */
export function memoizeRequest<T>(key: string, read: () => T): T {
  const current = context.getStore();
  if (!current) return read();
  if (!current.memo.has(key)) current.memo.set(key, read());
  return current.memo.get(key) as T;
}
