import { accountHeaders, accountOrigin } from "./account-origin.ts";

export async function canAccessEndfield(request: Request): Promise<boolean> {
  const cookie = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim())
    .filter(value => /^(?:__Secure-|__Host-)?better-auth\.[^=]+=/.test(value)).join("; ");
  if (!cookie) return false;
  try {
    const response = await fetch(new URL("/api/platform/endfield-access", accountOrigin(request)), {
      headers: accountHeaders(request, { cookie, accept: "application/json" }),
      redirect: "error", signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
    });
    return response.status === 204;
  } catch { return false; }
}

export function endfieldNotFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}
