import { gameHref } from "@riic/shell/games";

/** Billing rollout belongs to Arknights; read its decision without duplicating the policy. */
export async function readAccountFeatureAccess(request: Request, configuredOrigin?: string) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  const noAccess = { agent: false, billing: false };
  if (request.method !== "GET") return Response.json(noAccess, { status: 405, headers });
  try {
    const current = new URL(request.url);
    const origin = gameHref("arknights", current.origin, configuredOrigin ?? process.env.VITE_ARKNIGHTS_ORIGIN ?? process.env.ENDFIELD_ACCOUNT_ORIGIN);
    if (new URL(origin).origin === current.origin) throw new Error("Feature access proxy loop");
    const cookie = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => /^(?:__Secure-|__Host-)?better-auth\.[^=]+=/.test(value)).join("; ");
    const response = await fetch(new URL("/api/account/feature-access", origin), {
      headers: { cookie, accept: "application/json" }, redirect: "error", signal: AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]),
    });
    if (!response.ok) throw new Error("Feature access unavailable");
    const value = await response.json();
    return Response.json({ agent: value?.agent === true, billing: value?.billing === true }, { headers });
  } catch { return Response.json(noAccess, { status: 503, headers }); }
}
