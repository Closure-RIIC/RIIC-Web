import { parseWebsiteSession } from "../../../../packages/shell/account-session.ts";
import { accountOrigin } from "./account-origin.ts";

/** Read-only bridge to the existing account service. No second auth database. */
export async function readAccountSession(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  let origin: URL;
  try {
    origin = accountOrigin(request);
  } catch {
    return Response.json({ error: "Invalid account service origin" }, { status: 503, headers });
  }
  const cookies = (request.headers.get("cookie") ?? "").split(";").map(x => x.trim())
    .filter(x => /^(?:__Secure-|__Host-)?better-auth\.[^=]+=/.test(x)).join("; ");
  if (!cookies) return Response.json(null, { headers });
  try {
    const upstream = await fetch(new URL("/api/auth/get-session?disableCookieCache=true&disableRefresh=true", origin), {
      headers: { cookie: cookies, accept: "application/json" }, signal: AbortSignal.timeout(5000), redirect: "error",
    });
    if (!upstream.ok) throw new Error();
    const value = await upstream.json();
    // Never expose tokens, session IDs or upstream Set-Cookie headers.
    return Response.json(parseWebsiteSession(value), { headers });
  } catch {
    return Response.json({ error: "Account service unavailable" }, { status: 503, headers });
  }
}
