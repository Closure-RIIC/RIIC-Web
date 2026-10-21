import { platformForwardHeaders, platformOrigin } from "@riic/platform-server/proxy";

/** The configured first-party service is the only allowed proxy destination. */
export function accountOrigin(request: Request): URL {
  if (process.env.PLATFORM_API_ORIGIN) {
    const origin = platformOrigin();
    if (origin.origin === new URL(request.url).origin) throw new Error("Invalid platform service origin");
    return origin;
  }
  const configured = process.env.ENDFIELD_ACCOUNT_ORIGIN || (process.env.NODE_ENV === "development" ? "http://127.0.0.1:5175" : "");
  if (!configured) throw new Error("Account service is not configured");
  const origin = new URL(configured);
  const local = ["127.0.0.1", "localhost"].includes(origin.hostname);
  if (origin.origin === new URL(request.url).origin || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password ||
    (origin.protocol !== "https:" && !(local && process.env.NODE_ENV === "development" && origin.protocol === "http:"))) throw new Error("Invalid account service origin");
  return origin;
}
export function accountHeaders(request: Request, headers: HeadersInit): HeadersInit {
  if (!process.env.PLATFORM_API_ORIGIN) return headers;
  const forwarded = platformForwardHeaders(request, headers);
  if (request.headers.has("origin")) forwarded.set("origin", new URL(request.url).origin);
  return forwarded;
}
