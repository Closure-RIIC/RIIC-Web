import type { BrowserContext } from "@playwright/test";

/** Send the real signed session over the HTTP test transport in WebKit, which
 * does not send CI's Secure authentication cookie to loopback HTTP URLs. */
export async function attachLoopbackSession(context: BrowserContext, baseURL: string, browserName: string, sessionCookies: string[]) {
  if (browserName !== "webkit") return;
  const origin = new URL(baseURL).origin;
  await context.route(url => url.origin === origin && !url.pathname.startsWith("/_next/") && !url.pathname.startsWith("/images/"), async route => {
    const headers = await route.request().allHeaders();
    const locale = (await context.cookies()).find(cookie => cookie.name === "riic-locale")?.value ?? "zh";
    const response = await route.fetch({ headers: { ...headers, cookie: [...sessionCookies, `riic-locale=${locale}`].join("; ") } });
    await route.fulfill({ response });
  });
}
