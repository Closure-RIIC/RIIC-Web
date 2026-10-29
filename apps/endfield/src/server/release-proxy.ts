import { isEndfieldReleasePath } from "@riic/platform-server/proxy";
import { RELEASE_LIMITS } from "@riic/arknights-domain/releases/validation";
import { accountHeaders, accountOrigin } from "./account-origin.ts";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "Content-Type": "application/json" };
const failure = (status: number) => Response.json({ success: false, error: { code: "RELEASE_UNAVAILABLE" } }, { status, headers });

/** Only release routes are bridged, using the same shared account and administrator policy. */
export async function forwardEndfieldReleases(request: Request) {
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
    if (!request.headers.get("content-type")?.startsWith("application/json")) return failure(400);
    if (Number(request.headers.get("content-length")) > RELEASE_LIMITS.bodyBytes) return failure(413);
    // Bound the stream even when Content-Length is absent or incorrect. Keep the
    // bridge independent of Arknights' solver validation and diagnostic storage.
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (reader) while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > RELEASE_LIMITS.bodyBytes) { await reader.cancel(); return failure(413); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      body = JSON.stringify(JSON.parse(new TextDecoder().decode(bytes)));
    } catch { return failure(400); }
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
