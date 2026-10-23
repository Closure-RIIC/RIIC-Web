const sharedPaths = new Set(["/api/workspace", "/api/account/data-consent", "/api/account/session/extend", "/api/platform/session", "/api/platform/endfield-access"]);

export function isPlatformPath(pathname: string): boolean {
  return sharedPaths.has(pathname) || ["/api/auth/", "/api/skland/", "/api/endfield/skland/"].some(prefix => pathname.startsWith(prefix));
}

export function platformOrigin(value = process.env.PLATFORM_API_ORIGIN): URL {
  if (!value) throw new Error("PLATFORM_API_ORIGIN is not configured");
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password || (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))) {
    throw new Error("Platform origin must be HTTPS or a loopback HTTP origin");
  }
  return url;
}

export function platformForwardHeaders(request: Request, extra?: HeadersInit): Headers {
  const headers = new Headers(extra ?? request.headers);
  for (const name of ["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-authorization", "proxy-authenticate", "host", "forwarded", "x-forwarded-for", "x-real-ip", "cf-connecting-ip"]) headers.delete(name);
  const url = new URL(request.url);
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", url.protocol.slice(0, -1));
  headers.set("accept-encoding", "identity");
  // Only a trusted ingress may supply the original client address.
  if (process.env.BETA_TRUST_PROXY_HEADERS === "1") {
    const address = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (address) headers.set("x-real-ip", address);
  }
  return headers;
}

export async function forwardPlatformRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!isPlatformPath(url.pathname)) return new Response(null, { status: 404 });
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== url.origin) {
    return Response.json({ success: false, error: { code: "INVALID_ORIGIN" } }, { status: 403 });
  }
  try {
    const target = platformOrigin();
    if (target.origin === url.origin) throw new Error("Platform proxy loop");
    const headers = platformForwardHeaders(request);
    const upstream = await fetch(new URL(url.pathname + url.search, target), {
      method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      duplex: "half", redirect: "manual", signal: AbortSignal.any([request.signal, AbortSignal.timeout(65_000)]),
    } as RequestInit);
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("Cache-Control", "private, no-store");
    responseHeaders.set("Vary", "Cookie");
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return Response.json({ success: false, error: { code: "PLATFORM_UNAVAILABLE", retryable: true } }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
