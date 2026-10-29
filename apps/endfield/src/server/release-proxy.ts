import { isEndfieldReleasePath } from "@riic/platform-server/proxy";
import { readJsonBody, failureResponse, createRequestId } from "@riic/platform-server/api-contract";
import { RELEASE_LIMITS } from "@riic/arknights-domain/releases/validation";
import { accountHeaders, accountOrigin } from "./account-origin.ts";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "Content-Type": "application/json" };
const failure = (status: number) => Response.json({ success: false, error: { code: "RELEASE_UNAVAILABLE" } }, { status, headers });

/** Only release routes are bridged, using the same shared account and administrator policy. */
export async function forwardEndfieldReleases(request: Request) {
  const startedAt = performance.now();
  const url = new URL(request.url);
  if (!isEndfieldReleasePath(url.pathname)) return failure(404);
  const publicRead = url.pathname === "/api/endfield/releases";
  const allowed = request.method === "GET" ? !/\/releases\/.+/.test(url.pathname)
    : request.method === "POST" ? url.pathname === "/api/endfield/admin/releases"
    : request.method === "PATCH" && /^\/api\/endfield\/admin\/releases\/.+/.test(url.pathname);
  if (!allowed) return failure(405);
  if (request.method !== "GET" && request.headers.get("origin") !== url.origin) return failure(403);
  const cookie = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim())
    .filter(value => /^(?:__Secure-|__Host-)?better-auth\.[^=]+=/.test(value)).join("; ");
  if (!publicRead && !cookie) return failure(401);
  let body: string | undefined;
  if (request.method !== "GET") {
    try { body = JSON.stringify(await readJsonBody(request, RELEASE_LIMITS.bodyBytes)); }
    catch (error) { return failureResponse(error, createRequestId(), url.pathname, startedAt); }
  }
  try {
    const origin = accountOrigin(request);
    const upstream = await fetch(new URL(url.pathname + url.search, origin), {
      method: request.method, body, redirect: "error", signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
      headers: accountHeaders(request, { accept: "application/json", ...(publicRead ? {} : { cookie }),
        ...(body === undefined ? {} : { "content-type": "application/json", origin: origin.origin }) }),
    });
    // Never forward session cookies or internal service headers.
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch { return failure(502); }
}
