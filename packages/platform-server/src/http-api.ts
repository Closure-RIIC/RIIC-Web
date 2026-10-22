import { parseWebsiteSession } from "@riic/contracts/account-session";
import { withPlatformRequest } from "./request-context";
import { sharedSessionConfiguration } from "./auth/shared-session";

type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
type Routes = Partial<Record<string, Handler>>;
const routes: Record<string, () => Promise<Routes>> = {
  "/api/workspace": () => import("./http/workspace/route"),
  "/api/account/data-consent": () => import("./http/account/data-consent/route"),
  "/api/account/session/extend": () => import("./http/account/session/extend/route"),
  "/api/skland/account-data": () => import("./http/skland/account-data/route"),
  "/api/skland/accounts": () => import("./http/skland/accounts/route"),
  "/api/skland/auth/credential": () => import("./http/skland/auth/credential/route"),
  "/api/skland/auth/qr": () => import("./http/skland/auth/qr/route"),
  "/api/skland/auth/qr/status": () => import("./http/skland/auth/qr/status/route"),
  "/api/skland/data": () => import("./http/skland/data/route"),
  "/api/skland/inventory": () => import("./http/skland/inventory/route"),
  "/api/skland/role": () => import("./http/skland/role/route"),
  "/api/skland/session": () => import("./http/skland/session/route"),
  "/api/skland/status": () => import("./http/skland/status/route"),
  "/api/skland/status/refresh": () => import("./http/skland/status/refresh/route"),
  "/api/skland/sync": () => import("./http/skland/sync/route"),
  "/api/skland/training-sync": () => import("./http/skland/training-sync/route"),
};

async function dispatch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/platform/health" && request.method === "GET") {
    return Response.json({ service: "riic-platform", status: "ok", buildId: process.env.APP_BUILD_ID ?? "local-development" });
  }
  const { origins } = sharedSessionConfiguration();
  if (!origins.includes(url.origin)) return Response.json({ error: "Untrusted application origin" }, { status: 403 });
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== url.origin) {
    return Response.json({ error: "Invalid request origin" }, { status: 403 });
  }
  if (request.method === "GET" && ["/api/platform/session", "/api/auth/get-session"].includes(url.pathname)
    && !/(?:^|;\s*)(?:(?:__Secure-|__Host-)?better-auth\.session_token|aic_local_test_account)=/.test(request.headers.get("cookie") ?? "")) {
    return Response.json(null);
  }
  if (url.pathname === "/api/platform/session" && request.method === "GET") {
    const { websiteSession } = await import("./auth");
    return Response.json(parseWebsiteSession(await websiteSession(request)));
  }
  const endfield = /^\/api\/endfield\/skland\/([a-z-]+)$/.exec(url.pathname);
  if (url.pathname === "/api/platform/endfield-access") {
    return (await import("./auth/endfield-access")).endfieldAccessResponse(request);
  }
  if (endfield) return (await import("./skland/endfield-api")).handleEndfieldSkland(request, endfield[1]);
  const account = /^\/api\/skland\/accounts\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname);
  const load = url.pathname.startsWith("/api/auth/") ? () => import("./http/auth/[...all]/route")
    : account ? () => import("./http/skland/accounts/[id]/route") : routes[url.pathname];
  if (!load) return new Response(null, { status: 404 });
  const handlers: Routes = await load();
  const handler = handlers[request.method];
  if (!handler) return new Response(null, { status: 405, headers: { Allow: Object.keys(handlers).filter(key => /^[A-Z]+$/.test(key)).join(", ") } });
  const response = await handler(request, { params: Promise.resolve({ id: account?.[1] ?? "" }) });
  if (response.ok && url.pathname === "/api/auth/get-session") {
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return Response.json(parseWebsiteSession(await response.json()), { headers });
  }
  return response;
}

export async function handlePlatformRequest(request: Request): Promise<Response> {
  const start = performance.now();
  let response: Response;
  try { response = await withPlatformRequest(request, () => dispatch(request)); }
  catch { response = Response.json({ success: false, error: { code: "PLATFORM_UNAVAILABLE", retryable: true } }, { status: 503 }); }
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  response.headers.set("Server-Timing", `platform;dur=${(performance.now() - start).toFixed(1)}`);
  return response;
}
