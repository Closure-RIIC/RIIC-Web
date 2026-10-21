import { accountOrigin } from "./account-origin.ts";

const paths = {
  extend: "/api/account/session/extend",
  revoke: "/api/auth/revoke-sessions",
  delete: "/api/auth/delete-user",
} as const;
const authCookie = /^(?:__Secure-|__Host-)?better-auth\.[^=]+=/;
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const failure = (status: number, code = "REQUEST_FAILED") => Response.json({ success: false, error: { code } }, { status, headers });

/** Fixed account operations only; never accept a destination, user ID or callback URL. */
export async function accountSettings(request: Request, action: string) {
  if (request.method !== "POST" || !Object.hasOwn(paths, action)) return failure(404);
  if (request.headers.get("origin") !== new URL(request.url).origin) return failure(403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return failure(400);
  let origin: URL;
  try { origin = accountOrigin(request); } catch { return failure(503); }
  const cookies = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => authCookie.test(value));
  if (!cookies.length) return failure(401);
  let password: string | undefined;
  try {
    // Bound the actual stream, including clients that omit Content-Length.
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2048) { await reader.cancel(); return failure(413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => action !== "delete" || key !== "password")) return failure(400);
    if (action === "delete") {
      if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128) return failure(400);
      password = body.password;
    }
  } catch { return failure(400); }
  try {
    const upstream = await fetch(new URL(paths[action as keyof typeof paths], origin), {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      // Session extension specifically requires an empty request body.
      body: action === "extend" ? undefined : JSON.stringify(action === "delete" ? { password, callbackURL: origin.origin } : {}),
      headers: { cookie: cookies.join("; "), origin: origin.origin, "content-type": "application/json", accept: "application/json" },
    });
    const value = await upstream.json();
    if (!upstream.ok) return failure(upstream.status >= 500 ? 502 : upstream.status, value?.code === "INVALID_PASSWORD" ? "INVALID_PASSWORD" : "REQUEST_FAILED");
    const expiresAt = value?.data?.expiresAt;
    const valid = action === "extend" ? value?.success === true && typeof expiresAt === "string" && Number.isFinite(Date.parse(expiresAt))
      : action === "revoke" ? value?.status === true : value?.success === true && value?.message === "User deleted";
    if (!valid) return failure(502);
    const response = Response.json({ success: true, ...(action === "extend" ? { data: { expiresAt } } : {}) }, { headers });
    const hostname = new URL(request.url).hostname;
    for (const cookie of upstream.headers.getSetCookie()) {
      const domain = /;\s*domain=([^;]+)/i.exec(cookie)?.[1].replace(/^\./, "").toLowerCase();
      if (domain && hostname !== domain && !hostname.endsWith(`.${domain}`)) continue;
      if (!authCookie.test(cookie)) continue;
      const pair = cookie.split(";")[0];
      const maxAge = /;\s*max-age=(-?\d+)(?:;|$)/i.exec(cookie)?.[1];
      const expires = /;\s*expires=([^;]+)/i.exec(cookie)?.[1];
      const expired = maxAge !== undefined ? Number(maxAge) <= 0 : expires && Date.parse(expires) < Date.now();
      // Renewal may only extend the exact session token already supplied by this browser.
      const renewal = action === "extend" && /^(?:__Secure-|__Host-)?better-auth\.session_token=/.test(pair) && cookies.includes(pair);
      if (expired || renewal) response.headers.append("Set-Cookie", cookie);
    }
    return response;
  } catch { return failure(502); }
}
