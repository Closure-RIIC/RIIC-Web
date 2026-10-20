import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { loadSessionBootstrap } from "@shared/shell/account-session";

export const getInitialAccountSession = createServerFn({ method: "GET" }).handler(async () => {
  setResponseHeader("Cache-Control", "private, no-store");
  setResponseHeader("Vary", "Cookie");
  const request = getRequest();
  return loadSessionBootstrap(async () => {
    const { readAccountSession } = await import("./account-session");
    const response = await readAccountSession(request);
    if (!response.ok) throw new Error("Account service unavailable");
    return response.json();
  });
});
