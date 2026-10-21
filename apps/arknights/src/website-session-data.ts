import { parseWebsiteSession, type WebsiteSessionData } from "@riic/contracts/account-session";
export { parseWebsiteSession, type WebsiteSessionData } from "@riic/contracts/account-session";

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
