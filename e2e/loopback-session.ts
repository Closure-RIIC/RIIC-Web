import type { BrowserContext } from "@playwright/test";

/** Send the real signed session over the HTTP test transport in WebKit, which
 * does not send CI's Secure authentication cookie to loopback HTTP URLs. */
export async function attachLoopbackSession(context: BrowserContext, baseURL: string, browserName: string, sessionCookies: string[]) {
  if (browserName !== "webkit") return;
  const url = new URL(baseURL);
  if (url.protocol === "https:") return;
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Signed session headers are only allowed on HTTP loopback test origins.");
  }
  // These isolated account contexts use one origin and one locale. Block other
  // browser origins before setting the header so the session cannot leave it.
  await context.route(requestURL => requestURL.origin !== url.origin, route => route.abort("blockedbyclient"));
  const locale = (await context.cookies(baseURL)).find(cookie => cookie.name === "riic-locale")?.value ?? "zh";
  // Keep navigation, streaming, and cancellation in WebKit's native transport.
  // route.fetch buffers every response and can reset or stall context teardown.
  await context.setExtraHTTPHeaders({ cookie: [...sessionCookies, `riic-locale=${locale}`].join("; ") });
}
