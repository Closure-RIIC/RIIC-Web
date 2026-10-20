import { parseWebsiteSession, type WebsiteSessionData } from "../../../packages/shell/account-session.ts";
export { parseWebsiteSession, type WebsiteSessionData } from "../../../packages/shell/account-session.ts";

type WebsiteSessionFetch = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "json">>;

export async function requestWebsiteSession(
  fetchSession: WebsiteSessionFetch = fetch,
): Promise<WebsiteSessionData | null> {
  try {
    const response = await fetchSession("/api/auth/get-session", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    return parseWebsiteSession(await response.json());
  } catch {
    return null;
  }
}
