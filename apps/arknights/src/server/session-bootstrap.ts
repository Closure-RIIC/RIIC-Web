import { createServerFn } from "@tanstack/react-start";
import { appendResponseHeader, getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { loadSessionBootstrap } from "@riic/contracts/account-session";

export const getInitialWebsiteSession = createServerFn({ method: "GET" }).handler(async () => {
  setResponseHeader("Cache-Control", "private, no-store");
  setResponseHeader("Vary", "Cookie");
  const request = getRequest();
  return loadSessionBootstrap(async () => {
    if (process.env.PLATFORM_API_ORIGIN) {
      const { forwardPlatformRequest } = await import("@riic/platform-server/proxy");
      const response = await forwardPlatformRequest(new Request(new URL("/api/auth/get-session", request.url), {
        headers: request.headers, signal: AbortSignal.any([request.signal, AbortSignal.timeout(1500)]),
      }));
      if (!response.ok) throw new Error("Platform account service unavailable");
      for (const cookie of response.headers.getSetCookie()) appendResponseHeader("Set-Cookie", cookie);
      return response.json();
    }
    const { getAuth } = await import("@riic/platform-server/auth");
    const { localTestSession } = await import("@riic/platform-server/auth/local-test-account");
    const local = localTestSession(request);
    if (local) return local;
    const { response, headers } = await getAuth().api.getSession({
      headers: request.headers,
      returnHeaders: true,
    });
    // Preserve the same sliding-session renewal as the previous client request.
    for (const cookie of headers.getSetCookie()) appendResponseHeader("Set-Cookie", cookie);
    return response;
  });
});
