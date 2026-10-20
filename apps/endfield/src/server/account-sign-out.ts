import { accountOrigin } from "./account-origin.ts";

const authCookie = /^(?:__Secure-|__Host-)?better-auth\.[^=]+=/;
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/** Dedicated endpoint for revoking the current session. */
export async function signOutAccount(request: Request) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "Invalid request origin" }, { status: 403, headers });
  }
  let origin: URL;
  try { origin = accountOrigin(request); }
  catch { return Response.json({ error: "Account service unavailable" }, { status: 503, headers }); }
  const cookies = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => authCookie.test(value)).join("; ");
  try {
    const upstream = await fetch(new URL("/api/auth/sign-out", origin), {
      method: "POST", body: "{}", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { cookie: cookies, origin: origin.origin, "content-type": "application/json", accept: "application/json" },
    });
    if (!upstream.ok || (await upstream.json())?.success !== true) throw new Error("Sign-out failed");
    const response = Response.json({ success: true }, { headers });
    const hostname = new URL(request.url).hostname;
    // Only expired auth cookies may cross this bridge. Never install a session.
    for (const value of upstream.headers.getSetCookie()) {
      const domain = /;\s*domain=([^;]+)/i.exec(value)?.[1].replace(/^\./, "").toLowerCase();
      const expires = /;\s*expires=([^;]+)/i.exec(value)?.[1];
      const maxAge = /;\s*max-age=(-?\d+)(?:;|$)/i.exec(value)?.[1];
      const expired = maxAge !== undefined ? Number(maxAge) <= 0 : expires && Date.parse(expires) < Date.now();
      if (authCookie.test(value) && expired && (!domain || hostname === domain || hostname.endsWith(`.${domain}`))) {
        response.headers.append("Set-Cookie", value);
      }
    }
    return response;
  } catch {
    return Response.json({ error: "Unable to sign out" }, { status: 502, headers });
  }
}
