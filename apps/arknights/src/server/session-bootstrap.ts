import { createServerFn } from "@tanstack/react-start";
import { appendResponseHeader, getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { loadSessionBootstrap } from "../../../../packages/shell/account-session";

export const getInitialWebsiteSession = createServerFn({ method: "GET" }).handler(async () => {
  setResponseHeader("Cache-Control", "private, no-store");
  setResponseHeader("Vary", "Cookie");
  const request = getRequest();
  return loadSessionBootstrap(async () => {
    const { getAuth } = await import("./auth");
    const { localTestSession } = await import("./auth/local-test-account");
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
