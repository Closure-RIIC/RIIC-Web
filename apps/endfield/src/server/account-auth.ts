import { accountHeaders, accountOrigin } from "./account-origin.ts";

const commands = new Set(["sign-in/email", "sign-up/email", "request-password-reset", "reset-password", "email-otp/send-verification-otp", "email-otp/verify-email"]);
const authCookie = /^(?:__Secure-|__Host-)?better-auth\.[^=]+=/;
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const failure = (status: number) => Response.json({ code: "AUTH_UNAVAILABLE", message: "Account request failed. Please try again." }, { status, headers });

/** Only the operations used by the shared sign-in dialog can cross this bridge. */
export async function authenticateAccount(request: Request) {
  const publicUrl = new URL(request.url);
  const command = publicUrl.pathname.replace(/^\/api\/auth\//, "");
  const resetCallback = request.method === "GET" && /^reset-password\/[^/]+$/.test(command);
  if (!resetCallback && (request.method !== "POST" || !commands.has(command))) return failure(404);
  if (!resetCallback && request.headers.get("origin") !== publicUrl.origin) return failure(403);
  if (!resetCallback && !request.headers.get("content-type")?.startsWith("application/json")) return failure(400);
  let body: string | undefined;
  try {
    if (!resetCallback) {
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16_384) { await reader.cancel(); return failure(413); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      body = new TextDecoder().decode(bytes);
      const value = JSON.parse(body);
      if (!value || typeof value !== "object" || Array.isArray(value)) return failure(400);
      for (const field of ["callbackURL", "redirectTo"]) {
        if (value[field] !== undefined && (typeof value[field] !== "string" || new URL(value[field], publicUrl).origin !== publicUrl.origin)) return failure(400);
      }
    } else {
      const callback = publicUrl.searchParams.get("callbackURL");
      if (!callback || new URL(callback, publicUrl).origin !== publicUrl.origin) return failure(400);
    }
  } catch { return failure(400); }
  try {
    const origin = accountOrigin(request);
    const cookie = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => authCookie.test(value)).join("; ");
    const upstream = await fetch(new URL(publicUrl.pathname + publicUrl.search, origin), {
      method: request.method, body, redirect: "manual", signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
      headers: accountHeaders(request, { cookie, origin: publicUrl.origin, "content-type": "application/json", accept: "application/json" }),
    });
    if (resetCallback) {
      const location = upstream.headers.get("location");
      if (![302, 303, 307].includes(upstream.status) || !location) return failure(502);
      const destination = new URL(location, origin);
      if (destination.origin !== publicUrl.origin) return failure(502);
      return new Response(null, { status: 303, headers: { ...headers, Location: destination.href } });
    }
    const value = await upstream.json();
    if (!upstream.ok) return Response.json({
      code: typeof value?.code === "string" ? value.code : "AUTH_UNAVAILABLE",
      message: typeof value?.message === "string" ? value.message : "Account request failed. Please try again.",
    }, { status: upstream.status >= 500 ? 502 : upstream.status, headers });
    // The client needs success only; tokens and private account fields stay server-side.
    const response = Response.json({ success: true }, { headers });
    for (const cookie of upstream.headers.getSetCookie()) {
      const domain = /;\s*domain=([^;]+)/i.exec(cookie)?.[1].replace(/^\./, "").toLowerCase();
      if (authCookie.test(cookie) && (!domain || publicUrl.hostname === domain || publicUrl.hostname.endsWith(`.${domain}`))) response.headers.append("Set-Cookie", cookie);
    }
    return response;
  } catch { return failure(502); }
}
