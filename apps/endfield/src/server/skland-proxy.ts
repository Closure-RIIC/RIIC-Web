import { accountHeaders, accountOrigin } from "./account-origin.ts";

const allowedCookies = /^(?:(?:__Secure-|__Host-)?better-auth\.[^=]+|skland_accounts_v3|skland_account_v3_[A-Za-z0-9_-]+|skland_endfield_v1|skland_endfield_account_v1_[A-Za-z0-9_-]+)=/;
const writableCookies = /^(?:skland_account_v3_[A-Za-z0-9_-]+|skland_endfield_v1|skland_endfield_account_v1_[A-Za-z0-9_-]+)=/;
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const failure = (message: string, status: number, code: string) => Response.json({ success: false, error: { message, code } }, { status, headers });

/** Narrow, same-origin bridge. Never expose an open proxy or forward auth writes. */
export async function forwardEndfieldSkland(request: Request, action: string) {
  const allowed = request.method === "GET" ? action === "accounts"
    : request.method === "POST" && ["roles", "sync", "credential", "disconnect", "qr", "qr-status"].includes(action);
  if (!allowed) return failure("Not found", 404, "AIC-AUTH-2007");
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin) {
    return failure("请求来源无效，请刷新页面重试。", 403, "AIC-AUTH-2002");
  }
  let origin: URL;
  try { origin = accountOrigin(request); }
  catch { return failure("账号服务未配置。", 503, "AIC-AUTH-2003"); }
  const cookie = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => allowedCookies.test(value)).join("; ");
  if (!/(?:^|; )(?:__Secure-|__Host-)?better-auth\.[^=]+=/.test(cookie)) return failure("请先登录 RIIC 网站账号。", 401, "AIC-AUTH-2008");
  let body: string | undefined;
  if (request.method === "POST") {
    if (!request.headers.get("content-type")?.startsWith("application/json")) return failure("请提交 JSON 数据。", 400, "AIC-REQ-1001");
    if (Number(request.headers.get("content-length")) > 16 * 1024) return failure("提交的数据过大。", 413, "AIC-REQ-1002");
    // Bound the actual stream as well as Content-Length.
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try { if (reader) {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 16 * 1024) { await reader.cancel(); return failure("提交的数据过大。", 413, "AIC-REQ-1002"); }
        chunks.push(next.value);
      }
    } } catch { return failure("请求已中断，请重试。", 400, "AIC-REQ-1001"); }
    const combined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
    body = new TextDecoder().decode(combined);
  }
  try {
    const upstream = await fetch(new URL(`/api/endfield/skland/${action}`, origin), {
      method: request.method, body, redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(65000)]),
      headers: accountHeaders(request, { cookie, accept: "application/json", ...(body !== undefined ? { "content-type": "application/json", origin: origin.origin } : {}) }),
    });
    const response = new Response(upstream.body, { status: upstream.status, headers: { ...headers, "Content-Type": "application/json" } });
    for (const value of upstream.headers.getSetCookie()) {
      if (writableCookies.test(value) && !/;\s*domain=/i.test(value)) response.headers.append("Set-Cookie", value);
    }
    return response;
  } catch {
    return failure("森空岛服务暂不可用，请稍后重试。", 502, "AIC-SYS-5000");
  }
}
